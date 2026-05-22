const request = require("supertest");
const app = require("../src/app"); 
const prisma = require("../src/config/prisma"); // Added /src/
const bcrypt = require('bcrypt');
const BankConstants = require('../src/utils/constants'); // Added /src/ if utils is inside src

describe('Banking Ledger System- Integration Tests',()=>{
    let alice, bob, aliceToken
    const password = 'Password123!';
    //this runs once to set up our users for the test
    beforeEach(async ()=>{
        const hash = await bcrypt.hash(password, 10);
        
        alice = await prisma.user.create({
            data:{name:'Alice', email:'alice@test.com', password : hash, balance:100}
        });

        bob = await prisma.user.create({
            data:{name: 'Bob',email:'bob@test.com', password: hash, balance:0}

        })

        //get a real jwt token for alice
        const loginRes = await request(app)
              .post('/api/v1/login')
              .send({email:'alice@test.com', password});

        aliceToken = loginRes.body.token;
    })
    //test 1 
    // testing if a simple money transfer works 
    it('should successfully transfer $50 from Alice to Bob', async()=>{
        const res = await request(app)
            .post('/api/v1/transfer')
            .set('Authorization',`Bearer ${aliceToken}`)
            .send({receiverId:bob.id, amount:50})
        
        expect(res.status).toBe(200)
        const updatedAlice = await prisma.user.findUnique({where:{id:alice.id}})
        const updatedBob = await prisma.user.findUnique({where:{id:bob.id}})
        expect(Number(updatedAlice.balance)).toBe(50)
        expect(Number(updatedBob.balance)).toBe(50)
    })

    //test 2
    // overdraft fee logic
    it('should charge $5 fee when the transfer causes a negative balance', async()=>{
        const res = await request(app)
           .post('/api/v1/transfer')
           .set('Authorization',`Bearer ${aliceToken}`)
           .send({receiverId:bob.id, amount:110})
        
        expect(res.status).toBe(200)
        const updatedAlice = await prisma.user.findUnique({where:{id: alice.id}})
        const updatedBob = await prisma.user.findUnique({where:{id:bob.id}})
        expect(Number(updatedAlice.balance)).toBe(-15)

        const feeTx = await prisma.transaction.findFirst({where:{senderId:alice.id, receiverId: BankConstants.SYSTEM_ACCOUNTS.REVENUE}})
        expect(feeTx).toBeDefined()
        expect(Number(feeTx.amount)).toBe(5)
    })

    //test 3
    //HARD CREDIT LIMIT (-$100)
    //Risk: A user could drain infinite money if we don't stop them at -$100.
    it('should block transfer if it exceeds the -$100 credit limit', async () => {
        // Alice tries to send $300 (Total debt would be -$205 with fee)
        const res = await request(app)
            .post('/api/v1/transfer')
            .set('Authorization', `Bearer ${aliceToken}`)
            .send({ receiverId: bob.id, amount: 300 });

        expect(res.status).toBe(400); // Bad Request
        
        const updatedAlice = await prisma.user.findUnique({ where: { id: alice.id } });
        expect(Number(updatedAlice.balance)).toBe(100); // Balance should NOT change
    });

    //test 4
    //Risk: Compromised accounts could be emptied instantly without a daily cap.
    it('should block transfer if daily spending exceeds $500', async () => {
        // First, give Alice enough money to actually spend $600
        await prisma.user.update({
            where: { id: alice.id },
            data: { balance: 1000 }
        });

        const res = await request(app)
            .post('/api/v1/transfer')
            .set('Authorization', `Bearer ${aliceToken}`)
            .send({ receiverId: bob.id, amount: 600 });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Daily limit/);
    });

    //test 5
    // Two requests at once could "double spend" the same $100.
    it('should prevent double-spending using pessimistic locking', async () => {
        // Alice fires TWO requests for $100 at the exact same millisecond
        const [res1, res2] = await Promise.all([
            request(app).post('/api/v1/transfer').set('Authorization', `Bearer ${aliceToken}`).send({ receiverId: bob.id, amount: 150 }),
            request(app).post('/api/v1/transfer').set('Authorization', `Bearer ${aliceToken}`).send({ receiverId: bob.id, amount: 150 })
        ]);

        const statuses = [res1.status, res2.status];
        
        // One should work, one should fail
        expect(statuses).toContain(200);
        expect(statuses).toContain(400);

        const updatedAlice = await prisma.user.findUnique({ where: { id: alice.id } });
        expect(Number(updatedAlice.balance)).toBe(-55);
        await new Promise(resolve => setTimeout(resolve, 500));
    });

    //test 6
    //Malicious inputs (negative numbers) could act as "deposits".
    it('should reject negative transfer amounts', async () => {
        const res = await request(app)
            .post('/api/v1/transfer')
            .set('Authorization', `Bearer ${aliceToken}`)
            .send({ receiverId: bob.id, amount: -50 });

        expect(res.status).toBe(400);
        
        const updatedAlice = await prisma.user.findUnique({ where: { id: alice.id } });
        expect(Number(updatedAlice.balance)).toBe(100); // No money moved
    });

    it('should block requests with HTTP 429 after 5 transfer attempts', async () => {
    // 1. Send 5 rapid requests to hit the limit max
    for (let i = 0; i < 5; i++) {
        await request(app)
            .post('/api/v1/transfer')
            .set('Authorization', `Bearer ${aliceToken}`)
            .send({ receiverId: bob.id, amount: 1 });
    }

    // 2. The 6th request should trigger the limit
    const res6 = await request(app)
        .post('/api/v1/transfer')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ receiverId: bob.id, amount: 1 });

    expect(res6.status).toBe(429);
    expect(res6.body.message).toMatch(/Excessive transfer attempts detected/);
},15000); // <-- EXTRA TIME FOR CLOUD NETWORK LATENCY
})