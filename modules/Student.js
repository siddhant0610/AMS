import mongoose from "mongoose";

const StudentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    regNo: { type: String, required: true, unique: true },
    email: {
        type: String, required: true, unique: true, lowercase: true,
        trim: true
    },
    // department: { type: String, required: true },
    // Semester: { type: Number, required: true },
    // password: { type: String, required: true },

    // Courses student is enrolled in (through sections)
    enrolledCourses: [{
        course: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course'
        },
        section: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Section'
        },

    }]
},);

export const Student = mongoose.model('Student', StudentSchema);