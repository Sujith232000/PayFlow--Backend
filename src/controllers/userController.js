const { gte, lte } = require('zod');
const prisma = require('../config/prisma');
const asyncWrapper = require('../middlewares/asyncWrapper');
const AppError = require('../utils/appError');
const BankConstants = require('../utils/constants');

/**
 * 1. TRANSFER MONEY LOGIC
 * Purpose: Moves funds between users, checks daily limits, and handles overdrafts.
 */
const transferMoney = asyncWrapper(async (req, res) => {
    // Extract inputs from the validated request body and auth middleware
    const { receiverId, amount } = req.body; 
    const senderId = req.userId; // Provided by protect middleware

    //console.log("--- DEBUG LIVE CONTROLLER GATE ---", { receiverId, amount, type: typeof amount });

    // 🚨 ABSOLUTE FAIL-SAFE GUARD: Reject negative numbers instantly at the controller gate
    if (amount <= 0) {
        throw new AppError("cannot be a negative number", 400);
    }

    // BUSINESS RULE: Users cannot send money to themselves.
    if (senderId === receiverId) {
        throw new AppError("Cannot send money to yourself", 400);
    }


    // --- DAILY LIMIT LOGIC ---
    // Fetch the user's spending record for today
    const limitRecord = await prisma.userDailyLimit.findUnique({ where: { userId: senderId } });
    let effectiveTotal = 0;

    // Check if the record exists AND if it was updated today
    if (limitRecord && limitRecord.lastResetDate.toDateString() === new Date().toDateString()) {
        effectiveTotal = Number(limitRecord.dailyTotal);
    }
    
    // Total spent today + this current amount must be <= $500
    if (effectiveTotal + amount > 500) {
        throw new AppError("Daily limit of $500 exceeded", 400);
    }

    // --- OVERDRAFT PRE-CALCULATION (SAFETY CHECK) ---
    // Fetch sender to check balance before starting the expensive database transaction
    const sender = await prisma.user.findUnique({ where: { id: senderId } });
    const currentBalance = Number(sender.balance);

    // Calculate if this transfer will trigger an overdraft fee
    const balanceAfterTransfer = currentBalance - amount;
    let totalCost = amount;
    
    if (balanceAfterTransfer < 0) {
        // If balance drops below 0, the bank adds a $5 overhead fee
        totalCost = amount + BankConstants.FINANCIAL.OVERDRAFT_FEE;
    }

    // HARD LIMIT: No user can go below -$100 (including the fee)
    if (currentBalance - totalCost < BankConstants.FINANCIAL.MAX_DEBT) {
        throw new AppError(`Transaction Denied: Exceeds ${BankConstants.FINANCIAL.MAX_DEBT} credit limit (including $${BankConstants.FINANCIAL.OVERDRAFT_FEE} fee)`, 400);
    }

    // --- ATOMIC DATABASE TRANSACTION ---
    // We use $transaction to ensure all steps succeed or all fail together.  
    await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5000ms'`;
        // 1. ROW-LEVEL LOCKING: 'FOR UPDATE' prevents other transactions from 
        // touching this user's balance until we are finished.
        const senderResult = await tx.$queryRaw`SELECT * FROM "User" WHERE id = ${senderId} FOR UPDATE`;
        const lockedSender = senderResult[0];
        if (!lockedSender) throw new AppError("Sender not found", 404);
        const actualBalance = Number(lockedSender.balance);
        if (actualBalance - amount < BankConstants.FINANCIAL.MAX_DEBT) {
            throw new AppError("Insufficient funds (Concurrency Check)", 400);
       }
        const receiver = await tx.user.findUnique({ where: { id: receiverId } });

        // Double-check existence inside the transaction for ultimate safety
        if (!lockedSender) throw new AppError("Sender not found", 404);
        if (!receiver) throw new AppError("Receiver not found", 404);

        // 2. MOVE THE MONEY: Update both balances
        await tx.user.update({
            where: { id: senderId },
            data: { balance: { decrement: amount } }
        });

        await tx.user.update({
            where: { id: receiverId },
            data: { balance: { increment: amount } }
        });

        // 3. OVERDRAFT FEE EXECUTION:
        // We only charge the fee if the user crossed the 0 line in THIS transaction.
        const wasPositive = Number(lockedSender.balance) >= 0; // past balance befor the transfer 
        const senderStatus = await tx.user.findUnique({ where: { id: senderId } }); // current balance after transfer
        const isNowNegative = Number(senderStatus.balance) < 0;

        if (wasPositive && isNowNegative) {
            // Subtract the fee from the user
            await tx.user.update({
                where: { id: senderId },
                data: { balance: { decrement: BankConstants.FINANCIAL.OVERDRAFT_FEE } }
            });

            // LOG THE FEE: Create a ledger record so the user sees why $5 left
            await tx.transaction.create({
                data: { 
                    amount: BankConstants.FINANCIAL.OVERDRAFT_FEE, 
                    senderId: senderId, 
                    receiverId: BankConstants.SYSTEM_ACCOUNTS.REVENUE 
                }
            });
        }

        // 4. LOG THE MAIN TRANSFER: Record the $ amount sent to the receiver
        await tx.transaction.create({
            data: { amount, senderId, receiverId }
        });

        // 5. UPDATE DAILY SPENDING: Upsert (Update or Insert) the limit record
        await tx.userDailyLimit.upsert({
            where: { userId: senderId },
            update: {
                dailyTotal: effectiveTotal + amount,
                lastResetDate: new Date()
            },
            create: {
                userId: senderId,
                dailyTotal: amount,
                lastResetDate: new Date()
            }
        });

        // 6. SECURITY AUDIT: Log success for bank compliance tracking
        await tx.securityLog.create({
            data: {
                event: 'Transfer Completed',
                status: 'Success',
                userId: senderId,
                ipAddress: req.ip,
                details: `User sent ${amount} to ${receiverId}`
            }
        });
    });

    res.status(200).json({ success: true, message: "Transfer Successful" });
});

/**
 * 2. GET USER PROFILE LOGIC
 */
const getUserDetails = asyncWrapper(async (req, res) => {
    const id = req.userId;

    // Fetch user but specifically 'select' only public/non-sensitive fields
    const user = await prisma.user.findUnique({
        where: { id },
        select: {
            id: true,
            name: true,
            email: true,
            balance: true
        }
    });

    if (!user) throw new AppError("User not found", 404);

    res.status(200).json({ success: true, data: user });
});

/**
 * 3. GET LEDGER HISTORY LOGIC (PAGINATED & FILTERED)
 */
const getLedgerHistory = asyncWrapper(async (req, res) => {
    // Extract validated query params. Zod coerced these to Numbers/Dates already.
    const { page, limit, startDate, endDate } = req.query;
    
    // Math: Skip determines how many rows the DB jumps over.
    // Example: Page 2, Limit 10 -> Skip (2-1)*10 = skip the first 10 rows.
    const skip = (page - 1) * limit;

    // DYNAMIC FILTER BUILDING:
    // We check for money sent OR money received by this user.
    const whereClause = {
        OR: [{ senderId: req.userId }, { receiverId: req.userId }],
    };

    // Only add 'createdAt' to the query if the user actually requested a date range.
    if (startDate || endDate) {
        whereClause.createdAt = {
            // The '...' spread operator adds these keys ONLY if they exist.
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate })
        };
    }

    // ATOMIC READ: We run 'fetch' and 'count' in a transaction to ensure 
    // the total count matches the data snapshot we see.
    const [transactions, totalcount] = await prisma.$transaction([
        prisma.transaction.findMany({
            where: whereClause,
            take: limit,        // How many rows to return
            skip: skip,         // Where to start
            orderBy: { createdAt: 'desc' } // Newest transactions first
        }),
        prisma.transaction.count({ where: whereClause })
    ]);

    res.status(200).json({
        success: true,
        data: transactions,
        meta: {
            totalcount,
            totalPages: Math.ceil(totalcount / limit),
            currentPage: page,
            hasNextPage: (page * limit) < totalcount // Logic: Is there another page?
        }
    });
});

module.exports = { transferMoney, getUserDetails, getLedgerHistory };