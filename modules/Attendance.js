import mongoose from "mongoose";

const AttendanceSchema = new mongoose.Schema({
    // Reference to the section
    section: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Section',
        required: true,
        index: true
    },
    
    // Reference to the course
    course: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true,
        index: true
    },
    
    // Teacher who marked attendance
    markedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Teacher',
        required: true
    },
    
    // Date of the class
    date: {
        type: Date,
        required: true,
        index: true
    },
    
    // Time slot
    startTime: {
        type: String,
        required: true
    },
    
    endTime: {
        type: String,
        required: true
    },
    
    // Day of week
    day: {
        type: String,
        enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        required: true
    },
    
    // Room where class was held
    // Topic covered in class (optional)
    topic: {
        type: String
    },
    
    // Student attendance records
    students: [{
        student: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Student',
            required: true
        },
        status: {
            type: String,
            enum: ['present', 'absent','not-considered'],
            required: true,
            default: 'absent'
        },
        markedAt: {
            type: Date,
            default: Date.now
        },
        remarks: {
            type: String
        }
    }],
    
    // Class status
    classHeld: {
        type: Boolean,
        default: true
    },
    
    // If class was cancelled
    cancelReason: {
        type: String
    },
    
    // Total students present
    totalPresent: {
        type: Number,
        default: 0
    },
    
    // Total students absent
    totalAbsent: {
        type: Number,
        default: 0
    },
    
    // Attendance percentage
    attendancePercentage: {
        type: Number,
        default: 0
    },
    
    // Lock attendance (prevent further changes)
    isLocked: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

// Compound index for unique attendance record per section per date per time
AttendanceSchema.index({ section: 1, date: 1, startTime: 1 }, { unique: true });

// Index for querying attendance by student
AttendanceSchema.index({ 'students.student': 1, date: 1 });

// Calculate totals before saving
AttendanceSchema.pre('save', function(next) {
    if (this.students && this.students.length > 0) {
        this.totalPresent = this.students.filter(s => s.status === 'present').length;
        this.totalAbsent = this.students.filter(s => s.status === 'absent').length;
        this.totalNotConsidered = this.students.filter(s => s.status === 'not-considered').length;
        const total = this.students.length;
        this.attendancePercentage = total > 0 ? Math.round((this.totalPresent / total) * 100) : 0;
    }
    next();
});

export const Attendance = mongoose.model('Attendance', AttendanceSchema);