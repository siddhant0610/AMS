import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { asyncHandler } from "../asyncHandler.js";
import { ApiError } from "../utils/api.Error.js";
import { Attendance } from "../modules/Attendance.js"; // Your Schema 2
import { Section } from "../modules/Section.js";       // Your Section Schema
import { Teacher } from "../modules/Teacher.js";
import { Student } from "../modules/Student.js";
import { processFaceBatch } from "../Services/faceRecognition.js"; // Your AI Service

// ===============================
// 🔧 CONFIG & HELPERS
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, "../../public/uploads/attendance");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const safeDelete = (filePath) => {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

const getDayName = (date) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
};

// ==========================================================================
// 1️⃣ GET TEACHER SESSIONS (SMART DASHBOARD)
// 🟢 Strategy B: Checks for today's sessions. If missing, Auto-Creates them.
// ==========================================================================
// export const getTeacherSessions = asyncHandler(async (req, res) => {
//   const user = req.user;
//   const today = new Date();
//   today.setHours(0, 0, 0, 0); // Normalize to midnight
//   const dayName = getDayName(today); // e.g., "Wednesday"

//   // 1. BRIDGE: Verify Teacher Identity
//   const teacherProfile = await Teacher.findOne({ email: user.email });
//   if (!teacherProfile) throw new ApiError(404, "Teacher profile not found");

//   // 2. CHECK: Do sessions already exist for today?
//   let todaySessions = await Attendance.find({
//     markedBy: teacherProfile._id,
//     date: today
//   })
//   .populate("course", "courseName courseCode")
//   .populate("section", "SectionName RoomNo");

//   // 3. AUTO-CREATE: If no sessions exist (or list is empty), generate them from Timetable
//   if (todaySessions.length === 0) {
//     console.log(`⚡ Auto-generating sessions for ${teacherProfile.name} on ${dayName}...`);

//     // A. Find Static Schedule: Sections where this teacher teaches TODAY
//     // Note: Using "Teacher" (Capital T) because your Section schema uses it.
//     const scheduledSections = await Section.find({
//       Teacher: teacherProfile._id,
//       "Day.Day": dayName
//     }).populate("Student.Reg_No"); // Need full student details for the roster

//     const newSessions = [];

//     // B. Loop through each class and create an Attendance document
//     for (const section of scheduledSections) {
//       // Filter: A section might meet Mon & Wed. Only get TODAY'S time slot.
//       const validSlots = section.Day.filter(d => d.Day.includes(dayName));

//       for (const slot of validSlots) {
//         // Double-Check: Prevent duplicate if running twice
//         const exists = await Attendance.findOne({
//            section: section._id, date: today, startTime: slot.startTime 
//         });
//         if (exists) continue;

//         // Prepare Empty Student List
//         const studentRecords = section.Student.map(s => ({
//           student: s.Reg_No._id,
//           status: "absent", // Default status
//           faceRecognition: { verified: false }
//         }));

//         // Create the Session
//         const session = await Attendance.create({
//           section: section._id,
//           course: section.Course,    // Assumes Section has Course ID
//           markedBy: teacherProfile._id,
//           date: today,
//           day: dayName,
//           startTime: slot.startTime,
//           endTime: slot.endTime,
//           roomNo: section.RoomNo,
//           students: studentRecords,
//           isLocked: false
//         });
        
//         newSessions.push(session);
//       }
//     }

//     // C. Re-fetch to get the populated data (Course Names, etc.)
//     if (newSessions.length > 0) {
//        todaySessions = await Attendance.find({
//           markedBy: teacherProfile._id,
//           date: today
//        })
//        .populate("course", "courseName courseCode")
//        .populate("section", "SectionName RoomNo");
//     }
//   }

//   // 4. FORMAT RESPONSE
//   const data = todaySessions.map(session => ({
//     id: session._id, // USE THIS ID for Face Uploads
//     subject: session.course?.courseName || "Unknown",
//     code: session.course?.courseCode || "",
//     section: session.section?.SectionName,
//     time: `${session.startTime} - ${session.endTime}`,
//     room: session.roomNo,
//     status: session.isLocked ? "Completed" : "Scheduled", // Status of the class itself
//     totalStudents: session.students.length,
//     presentCount: session.totalPresent
//   }));

//   // Sort by time (09:00 before 10:00)
//   data.sort((a, b) => a.time.localeCompare(b.time));

//   res.status(200).json({
//     success: true,
//     date: today.toDateString(),
//     count: data.length,
//     data
//   });
// });

// ==========================================================================
// 2️⃣ MARK ATTENDANCE (FACE RECOGNITION)
// ==========================================================================
export const markAttendanceWithFace = asyncHandler(async (req, res) => {
  const user = req.user;
  
  // 1. Verify Teacher
  const teacherProfile = await Teacher.findOne({ email: user.email });
  if (!teacherProfile) throw new ApiError(403, "Access denied");

  const { attendanceId } = req.params;
  const files = req.files || [];

  if (!files.length) throw new ApiError(400, "No images uploaded");

  // 2. Find the Session
  const attendance = await Attendance.findById(attendanceId)
    .populate("students.student", "regNo") // Fetch regNo for matching
    .populate("section");

  // if (!attendance) {
  //   files.forEach((f) => safeDelete(f.path));
  //   throw new ApiError(404, "Attendance session not found");
  // }

  // if (attendance.isLocked) {
  //   files.forEach((f) => safeDelete(f.path));
  //   throw new ApiError(403, "This class is already locked.");
  // }
  if (attendance.isLocked || new Date() > attendance.lockTime) {
    
    // Optional: Auto-update the boolean for clarity
    if (!attendance.isLocked) {
       attendance.isLocked = true;
       await attendance.save();
    }

    // Stop execution
    throw new ApiError(403, "This session is locked. Changes are no longer allowed.");
  }

  // 3. Process Faces
  const imagePaths = files.map((f) => f.path);
  
  // Call AI Service
  const batchResult = await processFaceBatch(
    imagePaths,
    attendance.section._id.toString()
  );

  if (!batchResult?.results) {
    throw new ApiError(500, "Face recognition service failed");
  }

  const presentStudents = new Set();

  // 4. Update Status based on Matches
  for (const imgResult of batchResult.results) {
    if (!imgResult.success) continue;

    for (const match of imgResult.matches) {
      // Find the student in the list
      const record = attendance.students.find(
        (s) => s.student.regNo === match.studentId
      );

      if (record && record.status !== "present") {
        record.status = "present";
        record.markedAt = new Date();
        record.faceRecognition = {
          confidence: match.confidence,
          verified: match.confidence >= 0.8, // Example threshold
        };
        presentStudents.add(match.studentId);
      }
    }
  }

  // 5. Save & Lock
  attendance.isLocked = true;
  await attendance.save(); // pre('save') hook calculates totals automatically

  // 6. Cleanup Images
  for (const file of files) {
    const newPath = path.join(
      UPLOAD_DIR,
      `${attendance._id}_${Date.now()}_${file.originalname}`
    );
    fs.renameSync(file.path, newPath);
  }

  res.json({
    success: true,
    message: "Attendance marked successfully",
    presentCount: presentStudents.size,
    totalStudents: attendance.students.length
  });
});

// ==========================================================================
// 3️⃣ GET SINGLE SESSION (For Details View)
// ==========================================================================
export const getSessionDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const session = await Attendance.findById(id)
    .populate("students.student", "name regNo")
    .populate("course", "courseName")
    .populate("section", "SectionName");

  if (!session) throw new ApiError(404, "Session not found");

  res.status(200).json({
    success: true,
    data: session
  });
});

// ==========================================================================
// 4️⃣ STUDENT: GET MY ATTENDANCE
// ==========================================================================
export const getMyAttendance = asyncHandler(async (req, res) => {
  const user = req.user;

  // 1. Verify Student
  const studentProfile = await Student.findOne({ email: user.email });
  if (!studentProfile) throw new ApiError(404, "Student profile not found");

  // 2. Find all sessions where this student is listed
  const records = await Attendance.find({
    "students.student": studentProfile._id,
  })
    .populate("course", "courseName courseCode")
    .populate("section", "SectionName")
    .sort({ date: -1 })
    .lean();

  // 3. Extract status specific to this student
  const data = records.map((a) => {
    const record = a.students.find(
      (s) => s.student.toString() === studentProfile._id.toString()
    );

    return {
      id: a._id,
      course: a.course?.courseName || "Unknown",
      code: a.course?.courseCode || "",
      section: a.section?.SectionName || "N/A",
      date: new Date(a.date).toDateString(),
      time: `${a.startTime} - ${a.endTime}`,
      status: record?.status || "absent", // 'present', 'absent', etc.
    };
  });

  res.json({ success: true, count: data.length, data });
});
export default{
  markAttendanceWithFace,
  getMyAttendance,
  getSessionDetails
}