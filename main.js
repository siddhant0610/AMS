// for importing the modules 
const express=require('express');
const mongoose=require('mongoose');
const app=express();
app.use(express.json());
app.use(express.urlencoded({extended:true}));
mongoose.connect();
app.use('./api/Course',Course);
