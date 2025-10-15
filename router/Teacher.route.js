import { Router } from "express";
import { AttendenceMarked } from "../controller/Attendence.Marked.js";
import { CreateStudent } from "../controller/CreateStudent.js";
const TeacherRoute=Router();
TeacherRoute.route('/createStudent').post(CreateStudent)
TeacherRoute.route('/markAttendence').post(AttendenceMarked)
export default TeacherRoute