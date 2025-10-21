import { Router } from "express";
import { MarkAttendanceWithFace } from "../controller/Attendence.Marked.js";
import { CreateStudent } from "../controller/CreateStudent.js";
const TeacherRoute=Router();
TeacherRoute.route('/createStudent').post(CreateStudent)
TeacherRoute.route('/markAttendence').post(MarkAttendanceWithFace)
export default TeacherRoute