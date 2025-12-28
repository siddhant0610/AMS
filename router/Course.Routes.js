import express from 'express';
import {
    CreateCourse,
    GetAllCourses,
    GetCourse,
    GetCourseByCode,
    UpdateCourse,
    DeleteCourse,
    AddSectionToCourse,
    GetCourseStudents,
    GetCourseStats
} from '../controller/Course.controller.js';

const Courserouter = express.Router();

// Basic CRUD
Courserouter.post('/', CreateCourse);
Courserouter.get('/', GetAllCourses);
Courserouter.get('/courses/:id', GetCourse);
Courserouter.get('/courses/code/:courseCode', GetCourseByCode);
Courserouter.put('/courses/:id', UpdateCourse);
Courserouter.delete('/courses/:id', DeleteCourse);

// Section management
Courserouter.post('/courses/:id/sections', AddSectionToCourse);

// Student data
Courserouter.get('/courses/:id/students', GetCourseStudents);

// Statistics
Courserouter.get('/courses/:id/stats', GetCourseStats);

export default Courserouter;