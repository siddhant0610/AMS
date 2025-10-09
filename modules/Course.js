import mongoose from "mongoose"
import { Student } from "./Student";
const mongoose=require('mongoose');
const CourseSchema=new mongoose.Schema({
    CourseName:{type:'String',required:true},
    Section:{type:'String',required:true},
    RoomNo:{type:'String',required:true},
    timming:{type:String,required:true},
    students:[{type:mongoose.Schema.Types.ObjectId,
        ref:"Student",
        required:true
    }],
   
},{timestamps:true})
export const Course=mongoose.model('Course',CourseSchema);
// cse21001
