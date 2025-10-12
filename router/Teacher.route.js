import { Router } from "express";
import { AttendenceMarked } from "../controller/Attendence.Marked.js";
const TeacherRoute=Router();
TeacherRoute.route('/markAttendence').post(AttendenceMarked)
export default TeacherRoute