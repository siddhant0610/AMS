import mongoose from "mongoose"
import { Student } from "./Student";
const mongoose=require('mongoose');
const CourseSchema=new mongoose.Schema({
    // CourseName:{type:'String',required:true},
    CourseDetails: {
        courseCode: { type: String, required: true, unique: true },
        CourseName: { type: String, required: true },
         Section:{type:String,required:true, trim:true},
        department:{type:mongoose.Schema.Types.ObjectId, ref:"Student"}
    },  
    // timming:{type:String,required:true},
    students:[{type:mongoose.Schema.Types.ObjectId,
        ref:"Student",
        required:true
    }],
    teacher:{type:mongoose.Schema.Types.ObjectId,
        ref:"Teacher"
    },
   
},{timestamps:true})
export const Course=mongoose.model('Course',CourseSchema);
// cse21001
