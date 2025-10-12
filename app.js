import express from 'express';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';
import cors from 'cors';
const app=express();
app.use(cors({
    origin:'process.env.ALLOWED_URL',
    credentials:true
}
))
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({extended:true}));
app.use(express.static('public'));
// import all routes
import TeacherRoute from './router/Teacher.route.js';

// declare routes
app.use('/api/v1/teacher',TeacherRoute);
export {app};