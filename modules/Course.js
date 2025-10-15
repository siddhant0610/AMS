import mongoose from "mongoose"
import { Student } from "./Student.js";
import { Teacher } from "./Teacher.js";
import { Section } from "./Section.js";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate";
const CourseSchema=new mongoose.Schema({
    // CourseName:{type:'String',required:true},
    CourseDetails: {
        courseCode: { type: String, required: true, unique: true,index:true },
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
CourseSchema.plugin(mongooseAggregatePaginate);
export const Course=mongoose.model('Course',CourseSchema);
// cse21001
