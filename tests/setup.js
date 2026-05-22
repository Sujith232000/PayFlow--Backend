require('dotenv').config();
const prisma = require('../src/config/prisma');
const BankConstants = require('../src/utils/constants'); // <-- Fixed the double "src" typo!

// beforeAll: A "Hook" that runs once before the entire test suite starts.
beforeAll(async () => {
  await prisma.$connect(); // Ensure the database is actually reachable
});

// beforeEach: A "Hook" that runs before EVERY single 'it()' block.
beforeEach(async () => {
  // 1. We delete data in reverse order of importance (Foreign Key order)
  await prisma.userDailyLimit.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.securityLog.deleteMany();
  await prisma.user.deleteMany(); // Delete users last because others depend on them

  // 2. Pre-seed the system revenue account so foreign keys pass safely
  await prisma.user.create({
    data: {
      id: BankConstants.SYSTEM_ACCOUNTS.REVENUE,
      name: 'Bank System Revenue',
      email: 'revenue@system.bank',
      password: 'SYSTEM_INTERNAL_SECURE_ACCOUNT_HASH',
      balance: 0
    }
  });
});

// afterAll: Runs once after every single test is finished.
afterAll(async () => {
  await prisma.$disconnect(); // Close the connection so Jest can exit
});