require('dotenv').config();
const prisma = require('../config/prisma');
const logger = require('../utils/logger');

const errorhandler = async (err, req, res, next) => {
    // 1. Establish robust fallback parameters
    let statusCode = err.statusCode || 500;
    let message = err.message || "Internal Server Error";
    let eventName = 'Request Failed';

    // 2. Safely log the structured error to Winston console/files
    logger.error(message, {
        method: req.method,
        path: req.originalUrl,
        userId: req.userId || null,
        statusCode: statusCode,
    });

    if (statusCode === 429) {
        eventName = 'suspicious activity limit exceeded';
    }

    // 3. Robust Data Insertion to SecurityLog table
    try {
        await prisma.securityLog.create({
            data: {
                event: 'Request Failure',
                status: 'Failure',
                userId: req.userId || null,
                ipAddress: req.ip || '127.0.0.1',
                details: JSON.stringify({
                    path: req.originalUrl,
                    errorMessage: message,
                    requestData: req.body ? req.body : {} // <-- SAFE COERCION: Never allows undefined to pass
                })
            }
        });
    } catch (logError) {
        logger.error("Failed to save security Log", { error: logError.message });
        console.log("SECURITY LOG FAILED:", logError.message); // ← add this
    }

    // 4. Safe Conditional Mappings for Prisma Engine Codes
    if (err.code) {
        if (err.code === 'P2025') {
            statusCode = 404;
            message = "resource not found";
        }
        if (err.code === 'P2002') {
            statusCode = 409;
            message = "this record already Exists ";
        }
        if (err.code === 'P2003') {
            statusCode = 400;
            message = 'Invalid Reference ID provided does not exist';
        }
    }

    // 5. Safe Response Delivery to client/test context
    console.log("FINAL STATUS BEING SENT:", statusCode, message); 
    return res.status(statusCode).json({
        success: false,
        message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : null
    });

};

module.exports = errorhandler;