const dotenv = require('dotenv');
dotenv.config()
const app = require('./src/app');


const PORT = process.env.PORT || 3000;

app.listen(PORT,()=>{
    console.log(`Banking Ledger System
        Server running on http://localhost:${PORT}
        Environment: Development`);
})