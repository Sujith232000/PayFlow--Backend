const express = require('express')
const helmet = require('helmet');
const userRoutes = require('./routes/userRoutes')
const errorhandler = require('./middlewares/errorMiddleware');
const app = express();


app.use(helmet());
app.use(express.json());
app.use('/api/v1', userRoutes);
app.use(errorhandler);

module.exports = app;