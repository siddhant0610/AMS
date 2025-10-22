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
import StudentRoute from './router/student.route.js';
import router from './router/sectionRoutes.js';
import attendance from './router/attendence.routes.js';
// declare routes
app.use('/api/v1/section',router);
app.use('/api/v1/student', StudentRoute);
app.use('/api/v1/teacher',TeacherRoute);
app.use('/api/v1/attendance',attendance);
export {app};