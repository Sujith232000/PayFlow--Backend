const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const asyncWrapper = require('../middlewares/asyncWrapper');
const prisma = require('../config/prisma');
require('dotenv').config()
const login = asyncWrapper(async(req,res)=>{
    const {email,password} = req.body
    const user = await prisma.user.findUnique({where: {email}})
    if(!user){
        const error = new Error("Invalid credentials");
        error.statusCode = 401
        throw error;
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password)
    if (!isPasswordCorrect){
        const error = new Error("Invalid Credentials")
        error.statusCode = 401;
        throw error
    }

    const token = jwt.sign({id:user.id},process.env.JWT_KEY,{
        expiresIn: '1d',
    });
    res.status(202).json({success:true, message: "I am definitely the new code", token});
   
})

module.exports = {login}