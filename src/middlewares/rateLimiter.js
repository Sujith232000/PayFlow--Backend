const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const Redis = require('ioredis');

// Re-structure your local environment setup to use the clean single string
const redisClient = new Redis(process.env.REDIS_URL);

redisClient.on('connect', () => {
    console.log('🏎️ Connected to Cloud Redis successfully for Rate Limiting');
});

redisClient.on('error', (err) => {
    console.error('Redis Connection Error:', err);
});

const transferLimiter = rateLimit({
    // Tell the rate limiter to communicate via ioredis
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    }),
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each user to 5 transfer attempts per window
    message: {
        success: false,
        message: "Too many transfer attempts from this account. Please try again after 15 minutes."
    },
    standardHeaders: true, 
    legacyHeaders: false, 
    keyGenerator: (req) => req.userId 
});

module.exports = transferLimiter;