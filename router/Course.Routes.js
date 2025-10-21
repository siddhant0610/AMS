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
} from '../controller/CourseController.js';

const Courserouter = express.Router();

// Basic CRUD
Courserouter.post('/courses', CreateCourse);
Courserouter.get('/courses', GetAllCourses);
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