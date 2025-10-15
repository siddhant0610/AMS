import { Router } from "express";
import{ Student } from "../modules/Student.js";
import { CreateStudent } from "../controller/CreateStudent.js";
const StudentRoute=Router();
StudentRoute.route('/createStudent').post(CreateStudent)
export default StudentRoute