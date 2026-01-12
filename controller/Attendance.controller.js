import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { asyncHandler } from "../asyncHandler.js";
import { ApiError } from "../utils/api.Error.js";

// Models
import { Attendance } from "../modules/Attendance.js"; 
import { Section } from "../modules/Section.js";       
import { Teacher } from "../modules/Teacher.js";
import { Student } from "../modules/Student.js";
// ❌ Submission Import Removed

// Services
import { processFaceBatch } from "../Services/faceRecognition.js"; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ SAFE DELETE
const safeDelete = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn(`⚠️ Warning: Could not delete temp file: ${filePath}. Windows lock active.`);
  }
};

/* ==========================================================================
   1️⃣ CHECK STATUS (Idempotency Check)
========================================================================== */
export const checkAttendanceStatus = asyncHandler(async (req, res) => {
  const { attendanceId } = req.params;
  const { includeData } = req.query; 

  let query = Attendance.findById(attendanceId).select("isLocked section course students");
  if (includeData === "true") {
    query = query.populate("students.student", "name regNo");
  }

  const attendance = await query;
  if (!attendance) throw new ApiError(404, "Session not found");

  const response = {
    success: true,
    attendanceId: attendance._id,
    isMarked: attendance.isLocked,
  };

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
   2️⃣ MARK ATTENDANCE (DIRECT MATCHING + ROBUST LOGIC)
========================================================================== */
export const markAttendanceWithFace = asyncHandler(async (req, res) => {
  const user = req.user;
  const { attendanceId } = req.params;
  const files = req.files || [];

  // 1. Validation
  const teacherProfile = await Teacher.findOne({ email: user.email });
  if (!teacherProfile) throw new ApiError(403, "Access denied");

  if (!files.length) throw new ApiError(400, "No images uploaded");
  if (files.length > 6) throw new ApiError(400, "Max 6 images allowed.");

  // 2. Get Attendance List (Populate Name for matching)
  const attendance = await Attendance.findById(attendanceId)
    .populate("students.student", "name regNo") // 👈 Need 'name' to match AI output
    .populate("section");

  if (!attendance) {
     files.forEach((f) => safeDelete(f.path));
     throw new ApiError(404, "Session not found");
  }

  // 3. Send Images to AI
  const imagePaths = files.map((f) => f.path);
  let batchResult;

  try {
    batchResult = await processFaceBatch(
      imagePaths,
      attendance.section._id.toString()
    );
  } catch (error) {
    files.forEach((f) => safeDelete(f.path));
    throw new ApiError(500, `AI Service failed: ${error.message}`);
  }

  // Cleanup images
  files.forEach((f) => safeDelete(f.path));

  // =========================================================
  // 🧠 LOGIC: ROBUST MATCHING (Case Insensitive)
  // =========================================================

  // Extract names from JSON result
  const detectedList = batchResult.results || [];
  console.log("📋 AI JSON Results:", detectedList);

  // 1. Create a Set of "Normalized" names from AI for fast, case-insensitive lookup
  const presentNamesSet = new Set();
  
  detectedList.forEach(item => {
    let rawName = "";
    if (typeof item === 'string') rawName = item;
    else rawName = item.label || item.name || item.student_name || "";

    if (rawName) {
        // Store as "siddhant sharma" (lowercase, trimmed)
        presentNamesSet.add(rawName.toLowerCase().trim());
    }
  });

  const responseList = [];
  let presentCount = 0;

  // IST Date Formatter Helper
  const formatIST = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { 
    timeZone: "Asia/Kolkata", 
    hour: "2-digit", 
    minute: "2-digit", 
    second: "2-digit",
    hour12: true 
  }) : "-";

  attendance.students.forEach((record) => {
    if (!record.student) return;

    // 2. Normalize DB Name
    const dbName = record.student.name || "";
    const normalizedDbName = dbName.toLowerCase().trim();

    // 3. Compare (Does "siddhant" exist in the AI set?)
    const isPresent = normalizedDbName && presentNamesSet.has(normalizedDbName);

    // Update Status
    if (isPresent) {
      record.status = "present";
      record.faceRecognition = { verified: true, confidence: 99 };
      record.markedAt = new Date(); 
      presentCount++;
    } else {
      record.status = "absent";
    }

    responseList.push({
      regNo: record.student.regNo,
      status: isPresent ? "Present" : "Absent",
      markedTime: isPresent ? formatIST(record.markedAt) : "-"
    });
  });

  // 4. Save & Return
  attendance.isLocked = true;
  await attendance.save();

  res.status(200).json({
    success: true,
    lectureId: attendance._id,
    message: "Attendance marked successfully",
    presentCount: presentCount,
    totalStudents: attendance.students.length,
    attendance: responseList
  });
});

/* ==========================================================================
   3️⃣ GET SESSION DETAILS
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

  if (user.role === "student") {
    const studentProfile = await Student.findOne({ email: user.email });
    if (!studentProfile) throw new ApiError(403, "Student profile not found.");

    const myRecord = session.students.find(
      (s) => s.student._id.toString() === studentProfile._id.toString()
    );

    if (!myRecord) throw new ApiError(403, "You are not enrolled in this session.");
    
    const now = new Date();
    // Assuming startTime is a Date object (Loosely Coupled)
    const classStart = new Date(session.startTime); 

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
        time: `${new Date(session.startTime).toLocaleTimeString("en-IN", {hour:"2-digit", minute:"2-digit", timeZone:"Asia/Kolkata"})} - ${new Date(session.endTime).toLocaleTimeString("en-IN", {hour:"2-digit", minute:"2-digit", timeZone:"Asia/Kolkata"})}`,
        room: session.roomNo,
        isCompleted: session.isLocked,
        myStatus: displayStatus,
        markedAt: myRecord.markedAt,
        faceVerified: myRecord.faceRecognition?.verified || false
      }
    });
  }

  res.status(200).json({
    success: true,
    data: session 
  });
});

/* ==========================================================================
   4️⃣ GET MY ATTENDANCE STATS
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