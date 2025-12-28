import { Router } from "express";
//import { MarkAttendanceWithFace } from "../controller/Attendence.Marked.js";
import { CreateStudent } from "../controller/CreateStudent.js";
import { addTeacher, getTeacherByEmail } from '../controller/Teacher.js'
const TeacherRoute=Router();
TeacherRoute.route('/addTeacher').post(addTeacher)
//TeacherRoute.route('/markAttendance').post(MarkAttendanceWithFace)
TeacherRoute.route('/:email').get(getTeacherByEmail);
export default TeacherRoute