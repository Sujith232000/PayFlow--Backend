const rateLimit = require('express-rate-limit');
const AppError = require('../utils/appError');

const transferLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    // Since it sits behind 'protect', req.userId is always populated for valid users.
    // If validation occurs, we fallback to a static string key to clear ERL's IPv6 checker.
    keyGenerator: (req) => {
        return req.userId ? String(req.userId) : 'unauthenticated-gate';
    },
    handler: (req, res, next) => {
        next(new AppError('Security Alert: Excessive transfer attempts detected', 429));
    },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = transferLimiter;