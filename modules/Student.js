import { Section } from './Section.js';
import mongoose from "mongoose";
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate';
const Schema=new mongoose.Schema({
    name:{type:String, required:true},
    regNo:{type:String, required:true, unique:true,index:true},
    email:{type:String, required:true},
    course:{type:String, required:true}, 
    department:{type:String, required:true},// which course the student is enrolled in 
    subjects:{type:[String], required:true},
   // photo:{type:[String],required:true},
   Semester:{type:Number,required:true,
    min:1,
    max:10,
   },
   Section:[{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Section"
   }],
   password:{type:String, required:true}
});
Schema.plugin(mongooseAggregatePaginate)
export const Student=mongoose.model('Student',Schema); 
//want jwt/bcrypt?