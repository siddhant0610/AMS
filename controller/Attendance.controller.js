import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { asyncHandler } from "../asyncHandler.js";
import { ApiError } from "../utils/api.Error.js";
import xlsx from "xlsx"; // 👈 Used to read the AI Excel report

// Models
import { Attendance } from "../modules/Attendance.js"; 
import { Section } from "../modules/Section.js";       
import { Teacher } from "../modules/Teacher.js";
import { Student } from "../modules/Student.js";
import { Submission } from "../modules/Submission.js"; // ⚠️ Check this path matches your folder structure

// Services
import { processFaceBatch } from "../Services/faceRecognition.js"; 

// ===============================
// 🔧 CONFIG & HELPERS
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ FIX: "Gentle" Delete - Ignores errors if file is locked
const safeDelete = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn(`⚠️ Warning: Could not delete temp file: ${filePath}. It might be locked by Windows.`);
  }
};

/* ==========================================================================
   1️⃣ CHECK STATUS (Idempotency Check)
   Route: GET /api/v1/attendance/status/:attendanceId
========================================================================== */
export const checkAttendanceStatus = asyncHandler(async (req, res) => {
  const { attendanceId } = req.params;
  const { includeData } = req.query; // ?includeData=true

  // 1. Find the Session (Lightweight query first)
  let query = Attendance.findById(attendanceId).select("isMarked section course students");
  
  if (includeData === "true") {
    // If frontend wants data immediately, fetch names
    query = query.populate("students.student", "name regNo");
  }

  const attendance = await query;

  if (!attendance) {
    throw new ApiError(404, "Session not found");
  }

  // 2. Prepare Response
  const response = {
    success: true,
    attendanceId: attendance._id,
    isMarked: attendance.isLocked, // ✅ True = Already Done, False = Needs Upload
  };

  // 3. Optional: Send the JSON data if requested & already marked
  if (includeData === "true" && attendance.isLocked) {
    response.attendance = attendance.students.map(record => ({
      regNo: record.student?.regNo || "Unknown",
      name: record.student?.name || "Unknown",
      status: record.status === "present" ? "Present" : "Absent"
    }));
    response.presentCount = attendance.students.filter(s => s.status === "present").length;
    response.totalStudents = attendance.students.length;
  }

  res.status(200).json(response);
});

/* ==========================================================================
   2️⃣ MARK ATTENDANCE (FACE RECOGNITION + EXCEL DECODE)
   Route: POST /api/v1/attendance/mark-face/:attendanceId
========================================================================== */
export const markAttendanceWithFace = asyncHandler(async (req, res) => {
  const user = req.user;
  const { attendanceId } = req.params;
  const files = req.files || [];

  // 1. Basic Validation
  const teacherProfile = await Teacher.findOne({ email: user.email });
  if (!teacherProfile) throw new ApiError(403, "Access denied");

  if (!files.length) throw new ApiError(400, "No images uploaded");
  if (files.length > 6) throw new ApiError(400, "Max 6 images allowed.");

  // 2. Get the Attendance List
  const attendance = await Attendance.findById(attendanceId)
    .populate("students.student", "regNo") 
    .populate("section");

  if (!attendance) {
     files.forEach((f) => safeDelete(f.path));
     throw new ApiError(404, "Session not found");
  }

  // =========================================================
  // 🌉 THE BRIDGE: Crossing from Attendance -> Submission
  // =========================================================
  
  // A. Extract all Student IDs
  const studentIds = attendance.students.map(s => s.student._id);
  
  // B. Find Submissions (in 'test' DB) for these students
  const submissions = await Submission.find({ 
    student: { $in: studentIds } 
  }).select("student name"); 

  // C. Create Lookup Dictionary: { "StudentID": "TrainingName" }
  const studentIdToNameMap = {};
  submissions.forEach(sub => {
    if(sub.student) {
        studentIdToNameMap[sub.student.toString()] = sub.name;
    }
  });

  // 3. Send Images to AI
  const imagePaths = files.map((f) => f.path);
  let batchResult;

  try {
    batchResult = await processFaceBatch(
      imagePaths,
      attendance.section._id.toString()
    );
  } catch (error) {
    // ✅ Safety: Delete images if AI crashes
    files.forEach((f) => safeDelete(f.path));
    throw new ApiError(500, `AI Service failed: ${error.message}`);
  }

  // ✅ Safety: Delete images after success
  files.forEach((f) => safeDelete(f.path));

  if (!batchResult?.excelBuffer) {
    throw new ApiError(500, "AI failed to generate Excel report.");
  }

  // =========================================================
  // 🧠 LOGIC: DECODE EXCEL -> MATCH NAMES -> UPDATE DB
  // =========================================================

  // A. Parse Excel
  const workbook = xlsx.read(batchResult.excelBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const excelData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
  
  // B. Get Names Detected by AI (Handles multiple header variations)
  const presentNames = excelData.map(row => row['Name'] || row['name'] || row['Student Name'] || row['Label']);
  
//  console.log("📋 AI Detected Names:", presentNames);

  // C. Match & Update
  const responseList = [];
  let presentCount = 0;

  attendance.students.forEach((record) => {
    if (!record.student) return;

    const studentId = record.student._id.toString();
    
    // 1. Look up the Training Name
    const trainingName = studentIdToNameMap[studentId];

    // 2. Check if AI found that name
    const isPresent = trainingName && presentNames.includes(trainingName);

    // 3. Mark Status
    if (isPresent) {
      record.status = "present";
      record.faceRecognition = { verified: true, confidence: 99 };
      record.markedAt = new Date();
      presentCount++;
    } else {
      record.status = "absent";
    }

    // 4. Add to JSON Response
    responseList.push({
      regNo: record.student.regNo,
      status: isPresent ? "Present" : "Absent"
    });
  });

  // 4. Save to Database
  attendance.isLocked = true;
  await attendance.save();

  // 5. Return JSON
  res.status(200).json({
    present:presentNames,
    success: true,
    lectureId: attendance._id,
    message: "Attendance marked successfully",
    fileName: `Attendance_${attendanceId}.xlsx`, // Just a reference
    presentCount: presentCount,
    totalStudents: attendance.students.length,
    attendance: responseList
  });
});

/* ==========================================================================
   3️⃣ GET SESSION DETAILS (Student/Teacher View)
   Route: GET /api/v1/attendance/session/:id
========================================================================== */
export const getSessionDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  const session = await Attendance.findById(id)
    .populate("students.student", "name regNo")
    .populate("course", "CourseName courseCode")
    .populate("section", "SectionName")
    .populate("markedBy", "name email");

  if (!session) throw new ApiError(404, "Session not found");

  // 🎓 STUDENT VIEW
  if (user.role === "student") {
    const studentProfile = await Student.findOne({ email: user.email });
    if (!studentProfile) throw new ApiError(403, "Student profile not found.");

    const myRecord = session.students.find(
      (s) => s.student._id.toString() === studentProfile._id.toString()
    );

    if (!myRecord) throw new ApiError(403, "You are not enrolled in this session.");
    
    // Calculate Status Display
    const now = new Date();
    const classStart = new Date(session.date); 
    const [hours, minutes] = session.startTime.split(':');
    classStart.setHours(hours, minutes, 0, 0);

    let displayStatus = myRecord.status;
    if (now < classStart) displayStatus = "Not Started";

    return res.status(200).json({
      success: true,
      data: {
        _id: session._id,
        courseName: session.course?.CourseName || "Unknown Course",
        courseCode: session.course?.courseCode,
        section: session.section?.SectionName,
        teacher: session.markedBy?.name || "Unknown Teacher",
        date: session.date,
        day: session.day,
        time: `${session.startTime} - ${session.endTime}`,
        room: session.roomNo,
        isCompleted: session.isLocked,
        myStatus: displayStatus,
        markedAt: myRecord.markedAt,
        faceVerified: myRecord.faceRecognition?.verified || false
      }
    });
  }

  // 👨‍🏫 TEACHER VIEW (Default)
  res.status(200).json({
    success: true,
    data: session 
  });
});

/* ==========================================================================
   4️⃣ GET MY ATTENDANCE STATS
   Route: GET /api/v1/attendance/student/stats
========================================================================== */
export const getMyAttendance = asyncHandler(async (req, res) => {
  const user = req.user;

  const studentProfile = await Student.findOne({ email: user.email });
  if (!studentProfile) throw new ApiError(404, "Student profile not found");

  const allRecords = await Attendance.find({
    "students.student": studentProfile._id,
    isLocked: true 
  }).populate("course", "CourseName courseCode credits").lean();

  const courseStats = {};

  allRecords.forEach((session) => {
    if (!session.course) return;

    const courseId = session.course._id.toString();
    const myRecord = session.students.find(
      (s) => s.student.toString() === studentProfile._id.toString()
    );
    const status = myRecord?.status || "absent";

    if (!courseStats[courseId]) {
      courseStats[courseId] = {
        courseId,
        courseName: session.course.CourseName || session.course.courseName,
        courseCode: session.course.courseCode,
        totalClasses: 0,
        presentCount: 0,
        absentCount: 0
      };
    }

    courseStats[courseId].totalClasses += 1;
    if (status === "present") courseStats[courseId].presentCount += 1;
    else courseStats[courseId].absentCount += 1;
  });

  const reportCard = Object.values(courseStats).map(stat => {
    const percentage = (stat.presentCount / stat.totalClasses) * 100;
    return {
      ...stat,
      percentage: parseFloat(percentage.toFixed(1)),
      status: percentage >= 75 ? "Safe" : "Low Attendance"
    };
  });

  res.status(200).json({
    success: true,
    totalCourses: reportCard.length,
    data: reportCard
  });
});