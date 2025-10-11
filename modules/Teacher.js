import mongoose  from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate";
// get the time table for the teacher for each section or course he is teaching
const CourseTeachingSchema=new mongoose.Schema({
Course:[{
 courseName:{  
    type:String,
    required:true
},
Section:{type:[String],required:true}
}],

});
const TeacherSchema=new mongoose.Schema({
    course:{type:[CourseTeachingSchema], default:[],index:true},
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    employeeId: { type: String, required: true, unique: true },
    department: { type: String, required: true },
    role: { type: String, enum: ['Faculty', 'HOD', 'Admin'], default: 'Faculty' }
}, { timestamps: true });
TeacherSchema.plugin(mongooseAggregatePaginate);
export const Teacher=mongoose.model('Teacher',TeacherSchema);