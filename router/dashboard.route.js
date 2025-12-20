import express from 'express';
import {
    getStudentDashboard,
    getTeacherDashboard
} from '../controller/dashboard.controller.js';
import { verifyJWT } from '../MiddleWares/authentication.js';
const dashboardRouter = express.Router();
dashboardRouter.get('/student', verifyJWT, getStudentDashboard);
dashboardRouter.get('/teacher', verifyJWT, getTeacherDashboard);
export default dashboardRouter;