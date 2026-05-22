const bcrypt = require('bcrypt')
const prisma = require('../config/prisma');
const asyncWrapper = require('../middlewares/asyncWrapper');
const signup = asyncWrapper(async (req,res)=>{
    const {email,password,name} = req.body;
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)
    const user = await prisma.user.create({
        data:{
            email,
            name,
            password: hashedPassword
        },
    });
    user.password = undefined;
    res.status(201).json({success:true, data:user})

})

module.exports = {signup}