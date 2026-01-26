import express from 'express';
import {
    CreateCourse,
    GetAllCourses,
    getCourses,
    UpdateCourse,
    DeleteCourse,
    AddSectionToCourse,
    GetCourseStudents
} from '../controller/Course.controller.js';
import { verifyJWT } from '../MiddleWares/authentication.js';

const Courserouter = express.Router();

// Basic CRUD
Courserouter.post('/', CreateCourse);
Courserouter.get('/allCourses', GetAllCourses);
Courserouter.get('/courses', verifyJWT, getCourses);
Courserouter.put('/courses/:id', UpdateCourse);
Courserouter.delete('/courses/:id', DeleteCourse);

// Section management
Courserouter.post('/courses/:id/sections', AddSectionToCourse);

// Student data
Courserouter.get('/courses/:id/students', GetCourseStudents);

// Statistics


export default Courserouter;