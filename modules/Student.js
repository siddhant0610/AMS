const mongoose=require('mongoose');
const Schema=new mongoose.Schema({
    name:{type:'String', required:true},
    regNo:{type:'String', required:true, unique:true},
    email:{type:'String', required:true},
    course:{type:'String', required:true}, // which course the student is enrolled in 
    subjects:{type:[String], required:true},
   // photo:{type:[String],required:true},
   Semister:{type:'Number',required:true,
    min:1,
    max:10,
   },
   password:{type:'String', required:true}
});
export const Student=mongoose.model('Student',Schema); 