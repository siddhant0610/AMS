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
app.use(express.json({limit:'16kb'}));
app.use(cookieParser());
app.use(express.urlencoded({extended:true,limit:'16kb'}));
app.use(express.static('public'));
// import all routes
import TeacherRoute from './router/Teacher.route.js';
import StudentRoute from './router/student.route.js';
import router from './router/sectionRoutes.js';
import Courserouter from './router/Course.Routes.js';
import attendance from './router/attendence.routes.js';
import loginRoute from './router/login.routes.js';
import dashboardRouter from './router/dashboar.route.js';
//import AdminRoute from './router/Admin.routes.js';
// declare routes
app.use('/api/v1/section',router);
app.use('/api/v1/dashboad',dashboardRouter)
app.use('/api/v1/login',loginRoute)
//app.use('/api/v1/admin',AdminRoute);
app.use('/api/v1/course',Courserouter);
app.use('/api/v1/student', StudentRoute);
app.use('/api/v1/teacher',TeacherRoute);
app.use('/api/v1/attendance',attendance);
export {app};