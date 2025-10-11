import mongoose  from "mongoose";
// get the time table for the teacher for each section or course he is teaching
const CourseTeachingSchema=new mongoose.Schema({
Course:[{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Course"
}],
});
const TeacherSchema=new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    employeeId: { type: String, required: true, unique: true },
    department: { type: String, required: true },
    role: { type: String, enum: ['Faculty', 'HOD', 'Admin'], default: 'Faculty' }
}, { timestamps: true });
const Teacher=mongoose.model('Teacher',TeacherSchema);