//require('dotenv').config({path:'./.env'});
import dotenv from 'dotenv';
import express from "express"
import connDb from "./db/index.js";
dotenv.config({
    path:'./.env'
});
connDb();
