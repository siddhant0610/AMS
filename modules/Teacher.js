import mongoose  from "mongoose";
// get the time table for the teacher for each section or course he is teaching
const CourseTeachingSchema=new mongoose.Schema({
Course:[{
    type:mongoose.Schema.Types.ObjectId,
    ref:"Course"
}],
});
const TeacherSchema=new mongoose.Schema({

});
const Teacher=mongoose.model('Teacher',TeacherSchema);