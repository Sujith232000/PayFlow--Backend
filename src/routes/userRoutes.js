const express = require('express');
const router = express.Router();
const {transferMoney,getUserDetails,getLedgerHistory} = require('../controllers/userController');
const {transferSchema,userIdschema,historyQuerySchema} = require('../validators/userValidator')
const validate = require ('../middlewares/validate')
const protect = require('../middlewares/authMiddleware');
const checkIdempotency = require('../middlewares/idempotencyMiddleware');
const {login} = require('../controllers/loginController')
const { signup } = require('../controllers/authController');
const transferLimiter = require('../middlewares/rateLimiter');


router.post('/transfer', protect, checkIdempotency, transferLimiter, validate(transferSchema), transferMoney);
router.post('/signup', signup)
router.post('/login', login)
router.get('/profile', protect, getUserDetails);
router.get('/history', protect, validate(historyQuerySchema, 'query'), getLedgerHistory )



module.exports = router;