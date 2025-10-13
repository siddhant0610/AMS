//require('dotenv').config({path:'./.env'});
import dotenv from 'dotenv';
import express from "express"
import connDb from "./db/index.js";
import {app} from './app.js'
dotenv.config({
    path:'./.env'
});

connDb()
.then(()=>{
    app.listen(process.env.PORT|| 5000,()=>{
        console.log(`Server is running on port ${process.env.PORT||5000}`);
})
})
.catch((err)=>{
    console.error("Failed to connect to the database",err)
})
