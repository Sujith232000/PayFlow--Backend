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

    // ABSOLUTE FAIL-SAFE GUARD: Reject negative numbers instantly at the controller gate
    if (amount <= 0) {
        throw new AppError("cannot be a negative number", 400);
    }

    // BUSINESS RULE: Users cannot send money to themselves.
    if (senderId === receiverId) {
        throw new AppError("Cannot send money to yourself", 400);
    }

    // --- DAILY LIMIT LOGIC ---
    const limitRecord = await prisma.userDailyLimit.findUnique({ where: { userId: senderId } });
    let effectiveTotal = 0;

    if (limitRecord && limitRecord.lastResetDate.toDateString() === new Date().toDateString()) {
        effectiveTotal = Number(limitRecord.dailyTotal);
    }
    
    if (effectiveTotal + amount > 500) {
        throw new AppError("Daily limit of $500 exceeded", 400);
    }

    // --- OVERDRAFT PRE-CALCULATION (SAFETY CHECK) ---
    const sender = await prisma.user.findUnique({ where: { id: senderId } });
    const currentBalance = Number(sender.balance);

    const balanceAfterTransfer = currentBalance - amount;
    let totalCost = amount;
    
    if (balanceAfterTransfer < 0) {
        totalCost = amount + BankConstants.FINANCIAL.OVERDRAFT_FEE;
    }

    if (currentBalance - totalCost < BankConstants.FINANCIAL.MAX_DEBT) {
        throw new AppError(`Transaction Denied: Exceeds ${BankConstants.FINANCIAL.MAX_DEBT} credit limit (including $${BankConstants.FINANCIAL.OVERDRAFT_FEE} fee)`, 400);
    }

    // --- ATOMIC DATABASE TRANSACTION ---
    await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5000ms'`;
        
        // 1. ROW-LEVEL LOCKING
        const senderResult = await tx.$queryRaw`SELECT * FROM "User" WHERE id = ${senderId} FOR UPDATE`;
        const lockedSender = senderResult[0];
        if (!lockedSender) throw new AppError("Sender not found", 404);
        
        const actualBalance = Number(lockedSender.balance);
        if (actualBalance - amount < BankConstants.FINANCIAL.MAX_DEBT) {
            throw new AppError("Insufficient funds (Concurrency Check)", 400);
        }
        
        const receiver = await tx.user.findUnique({ where: { id: receiverId } });
        if (!receiver) throw new AppError("Receiver not found", 404);

        // 2. MOVE THE MONEY: Capture the returned updated models to read the exact balances
        const updatedSender = await tx.user.update({
            where: { id: senderId },
            data: { balance: { decrement: amount } }
        });

        const updatedReceiver = await tx.user.update({
            where: { id: receiverId },
            data: { balance: { increment: amount } }
        });

        // Initialize our tracking states for the audit logs
        let finalSenderBalance = Number(updatedSender.balance);
        let feeChargedInThisSession = false;

        // 3. OVERDRAFT FEE EXECUTION
        const wasPositive = Number(lockedSender.balance) >= 0;
        const isNowNegative = Number(updatedSender.balance) < 0;

        if (wasPositive && isNowNegative) {
            const updatedSenderWithFee = await tx.user.update({
                where: { id: senderId },
                data: { balance: { decrement: BankConstants.FINANCIAL.OVERDRAFT_FEE } }
            });

            // Update our tracking states with the final post-fee calculations
            finalSenderBalance = Number(updatedSenderWithFee.balance);
            feeChargedInThisSession = true;

            // LOG THE FEE TO LEDGER
            await tx.transaction.create({
                data: { 
                    amount: BankConstants.FINANCIAL.OVERDRAFT_FEE, 
                    senderId: senderId, 
                    receiverId: BankConstants.SYSTEM_ACCOUNTS.REVENUE 
                }
            });
        }

        // 4. LOG THE MAIN TRANSFER (Cleaned up duplicate)
        await tx.transaction.create({
            data: { amount, senderId, receiverId }
        });

        // 🛠️ IMMUTABLE AUDIT TRAIL RECORDING
        await tx.auditLog.create({
            data: {
                userId: senderId,
                type: "TRANSFER_SENT",
                amount: Number(amount),
                balanceAfter: finalSenderBalance
            }
        });

        await tx.auditLog.create({
            data: {
                userId: receiverId,
                type: "TRANSFER_RECEIVED",
                amount: Number(amount),
                balanceAfter: Number(updatedReceiver.balance)
            }
        });

        if (feeChargedInThisSession) {
            await tx.auditLog.create({
                data: {
                    userId: senderId,
                    type: "OVERDRAFT_FEE",
                    amount: Number(BankConstants.FINANCIAL.OVERDRAFT_FEE),
                    balanceAfter: finalSenderBalance
                }
            });
        }

        // 5. UPDATE DAILY SPENDING
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

        // 6. SECURITY AUDIT
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