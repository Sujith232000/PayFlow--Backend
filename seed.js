const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(' Seeding database...');
  
  const alice = await prisma.user.create({
    data: {
      name: 'Alice',
      email: 'alice@test.com',
      password:'hashedpassword', // In a real scenario, ensure this is a properly hashed password
      balance: 100.00,
    },
  });

  const bob = await prisma.user.create({
    data: {
      name: 'Bob',
      email: 'bob@test.com',
      password:'hashedpassword', // In a real scenario, ensure this is a properly hashed password
      balance: 0.00,
    },
  });

  console.log('Created users:', { alice: alice.id, bob: bob.id });
}

main()
  .catch((e) => {
    console.error('Error seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });