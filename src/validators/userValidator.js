const {z, date} = require('zod')

const transferSchema = z.object({
    //senderId: z.string().uuid({message:"It has to follow the uuid"}),
    receiverId: z.string().uuid({message:"It has to follow the uuid"}),
    amount: z.number()
    .positive({message:"cannot be a negative number"})
    .max(10000,{message:"Single transfer cannot exceed $10,000"})
    .multipleOf(0.01,{message:"Amount cannot have more than 2 decimal places"})
})

// const userIdschema = z.object({
//     id: z.string().uuid({message: 'not a valid uuid'})
// })

const historyQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    startDate: z.preprocess((arg)=>((typeof arg === "string")? new Date(arg): arg), z.date().optional()),
    endDate: z.preprocess((arg)=>{
        if (typeof arg != "string"){
            return arg
        }
        const d = new Date(arg)
        d.setUTCHours(23,59,59,999)
        return d
    }, z.date().optional())
})


module.exports = { historyQuerySchema, transferSchema }