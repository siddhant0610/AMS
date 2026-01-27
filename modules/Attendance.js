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
    this.attendancePercentage = total > 0 
      ? Math.round((this.totalPresent / total) * 100) 
      : 0;
  }

  // ---------------------------------------------------------
  // 2️⃣ PART 2: Generate Unique Custom ID (Asynchronous)
  // ---------------------------------------------------------
  if (!this.customId) {
    try {
      const CourseModel = mongoose.model("Course");
      const SectionModel = mongoose.model("Section");

      const courseDoc = await CourseModel.findById(this.course).select("courseCode");
      const sectionDoc = await SectionModel.findById(this.section).select("SectionName");

      // Format Date: "28-01-26" (DD-MM-YY)
      const datePart = this.date.toLocaleDateString("en-GB", {
          day: '2-digit', month: '2-digit', year: '2-digit',
          timeZone: "Asia/Kolkata"
      }).replace(/\//g, '-');

      const cCode = courseDoc ? courseDoc.courseCode : "UNK";
      const sName = sectionDoc ? sectionDoc.SectionName : "UNK";

      // 🛠️ THE FIX: Add ':startTime' at the end
      // New Format: Wed:28-01-26:CSE3203:SecA:09:00
      this.customId = `${this.day}:${datePart}:${cCode}:${sName}:${this.startTime}`;

    } catch (error) {
      console.error("⚠️ Error generating customId:", error);
      // Fallback to random ID if generation fails to prevent crash
      this.customId = new mongoose.Types.ObjectId().toString();
    }
  }
  next();
});
export const Attendance = mongoose.model('Attendance', AttendanceSchema);