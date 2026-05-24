const prisma = require('../config/prisma');

const checkIdempotency = async (req, res, next) => {
    // 1. Look for the custom header sent by the client
    const idempotencyKey = req.headers['x-idempotency-key'];

    // If the client didn't provide a key, let the request pass through normally
    if (!idempotencyKey) {
        return next();
    }

    try {
        // 2. Check your PostgreSQL IdempotencyKey table for an existing record
        const existingRecord = await prisma.idempotencyKey.findUnique({
            where: { key: idempotencyKey }
        });

        // 3. If it exists, intercept! Return the saved canned response instantly
        if (existingRecord) {
            // console.log(`--- IDEMPOTENCY INTERCEPT: Key ${idempotencyKey} matched ---`);
            return res.status(200).json(existingRecord.response);
        }

        // 4. If it doesn't exist, override res.json temporarily so we can catch 
        // the success response payload when the controller finishes executing.
        const originalJson = res.json;
        res.json = async function (body) {
            // Only cache successful transaction responses
            if (res.statusCode === 200 && body && body.success === true) {
                try {
                    await prisma.idempotencyKey.create({
                        data: {
                            key: idempotencyKey,
                            response: body
                        }
                    });
                } catch (err) {
                    console.error("Failed to save idempotency key:", err);
                }
            }
            return originalJson.call(this, body);
        };

        next();
    } catch (error) {
        next(error);
    }
};

module.exports = checkIdempotency;