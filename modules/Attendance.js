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
    customId: {
    type: String,
    unique: true // Optional: Ensures you don't have duplicate IDs for the same class
  },
    // Day of week
    day: {
        type: String,
        enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday','Saturday','Sunday'],
        required: true
    },
    
    // Room where class was held
    roomNo: {
        type: String,
    },
    
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
    isMarked: {
        type: Boolean,
        default: false
    },
    lockTime: { 
    type: Date, 
    // Automatically set to 36 hours from creation
    default: () => new Date(+new Date() + 36 * 60 * 60 * 1000) 
  }
}, { timestamps: true });

// Compound index for unique attendance record per section per date per time
AttendanceSchema.index({ section: 1, date: 1, startTime: 1 }, { unique: true });

// Index for querying attendance by student
AttendanceSchema.index({ 'students.student': 1, date: 1 });

// Calculate totals before saving
AttendanceSchema.pre("save", async function (next) {
  
  // ---------------------------------------------------------
  // 1️⃣ PART 1: Calculate Statistics (Synchronous)
  // ---------------------------------------------------------
  if (this.students && this.students.length > 0) {
    this.totalPresent = this.students.filter(s => s.status === 'present').length;
    this.totalAbsent = this.students.filter(s => s.status === 'absent').length;
    this.totalNotConsidered = this.students.filter(s => s.status === 'not-considered').length;
    
    const total = this.students.length;
    // Prevent division by zero
    this.attendancePercentage = total > 0 
      ? Math.round((this.totalPresent / total) * 100) 
      : 0;
  }

  // ---------------------------------------------------------
  // 2️⃣ PART 2: Generate Custom ID (Asynchronous)
  // Only runs if customId is missing
  // ---------------------------------------------------------
  if (!this.customId) {
    try {
      // ⚠️ SAFE FETCHING: Use mongoose.model() to avoid circular dependency crashes
      const CourseModel = mongoose.model("Course");
      const SectionModel = mongoose.model("Section");

      const courseDoc = await CourseModel.findById(this.course).select("courseCode");
      const sectionDoc = await SectionModel.findById(this.section).select("SectionName");

      // Format Date: Use India Locale to ensure the date matches the 'Day'
      // (toISOString gives UTC, which might show the previous date if early morning)
    const datePart = this.date.toLocaleDateString("en-GB", {
         day: '2-digit', month: '2-digit', year: '2-digit',
         timeZone: "Asia/Kolkata"
      }).replace(/\//g, '-');

      const cCode = courseDoc ? courseDoc.courseCode : "UNK";
      const sName = sectionDoc ? sectionDoc.SectionName : "UNK";

      // Format: Monday:2026-01-24:CS101:SecA
      this.customId = `${this.day.slice(0,3)}:${datePart}-${cCode}-${sName}`;
      
    } catch (error) {
      console.error("⚠️ Error generating customId:", error);
      // We continue without customId rather than crashing the whole save
    }
  }

  next();
});

export const Attendance = mongoose.model('Attendance', AttendanceSchema);