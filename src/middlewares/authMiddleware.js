const jwt = require('jsonwebtoken')
const prisma = require('../config/prisma');
const asyncWrapper = require('./asyncWrapper')


const protect = asyncWrapper(async(req,res,next)=>{
    let token;

    if(req.headers.authorization && req.headers.authorization.startsWith('Bearer')){
        token = req.headers.authorization.split(' ')[1];
    }

    if(!token){
        const error = new Error("Not authorized to access this route")
        error.statusCode = 401;
        throw error 
    }

    const decoded = jwt.verify(token,process.env.JWT_KEY);
    const user = await prisma.user.findUnique({
        where:{id: decoded.id}
    })

    if (!user){
        const error = new Error("user no longer exists")
        error.statusCode = 401;
        throw error
    }
    req.userId = decoded.id;
    next()
});

module.exports = protect