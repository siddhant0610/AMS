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
   1️⃣ CHECK STATUS (is-marked)
   Returns: { success: true, lectureId: "...", isMarked: true/false }
========================================================================== */
export const checkAttendanceStatus = asyncHandler(async (req, res) => {
  const { attendanceId } = req.params;

  const attendance = await Attendance.findById(attendanceId).select("isLocked");

  if (!attendance) throw new ApiError(404, "Session not found");

  res.status(200).json({
    success: true,
    lectureId: attendance._id,
    isMarked: attendance.isLocked
  });
});

/* ==========================================================================
   2️⃣ MARK ATTENDANCE (mark-face)
   Returns: { success, lectureId, message, fileName, attendance: [...] }
========================================================================== */
export const markAttendanceWithFace = asyncHandler(async (req, res) => {
  const user = req.user;
  const { attendanceId } = req.params;
  const files = req.files || [];

  // 1. Validation
  const teacherProfile = await Teacher.findOne({ email: user.email });
  if (!teacherProfile) throw new ApiError(403, "Access denied");

  if (!files.length) throw new ApiError(400, "No images uploaded");

  // 2. Fetch Session
  const attendance = await Attendance.findById(attendanceId)
    .populate("students.student", "name regNo")
    .populate("section");

  if (!attendance) {
    files.forEach((f) => safeDelete(f.path));
    throw new ApiError(404, "Session not found");
  }

  // 3. AI Processing
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

  // Cleanup
  files.forEach((f) => safeDelete(f.path));

  // =========================================================
  // 🧠 LOGIC: ROBUST MATCHING
  // =========================================================

  const detectedList = batchResult.results || [];

  // A. Create Normalized Set
  const presentNamesSet = new Set();
  detectedList.forEach(item => {
    let rawName = typeof item === 'string' ? item : (item.label || item.name || "");
    if (rawName) presentNamesSet.add(rawName.toLowerCase().trim());
  });

  const responseList = [];
  let presentCount = 0;

  // B. Match & Update
  attendance.students.forEach((record) => {
    if (!record.student) return;

    const dbName = record.student.name || "";
    const normalizedDbName = dbName.toLowerCase().trim();
    const isPresent = normalizedDbName && presentNamesSet.has(normalizedDbName);

    if (isPresent) {
      record.status = "present";
      record.faceRecognition = { verified: true, confidence: 99 };
      record.markedAt = new Date();
      presentCount++;
    } else {
      record.status = "absent";
    }

    // Build the JSON Array Response
    responseList.push({
      regNo: record.student.regNo,
      name: record.student.name,
      status: isPresent ? "Present" : "Absent"
    });
  });
  attendance.totalPresent = presentCount;
  // 4. Save
  attendance.isLocked = true;
  await attendance.save();

  // =========================================================
  // ✅ JSON RESPONSE (Matches your requirement exactly)
  // =========================================================
  res.status(200).json({
    success: true,
    lectureId: attendance.customId,
    message: "Attendance marked successfully",
    fileName: `Attendance_${attendance.customId}.pdf`, // Just a string for Frontend to use
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
        time: `${new Date(session.startTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} - ${new Date(session.endTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}`,
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

// Helper: Add 50 minutes to "HH:MM"
const calculateEndTime = (startTime) => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes + 50); // Fixed 50 mins duration
    
    return date.toLocaleTimeString('en-US', {
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: "Asia/Kolkata"
    });
};

export const createAdHocSession = asyncHandler(async (req, res) => {
  const user = req.user;
  // Input: ["09:00", "11:00"] allow multiple slots for one date
  const { sectionName, date, timeSlots } = req.body;

  if (!date || !timeSlots || timeSlots.length === 0) {
      throw new ApiError(400, "Date and at least one time slot are required.");
  }

  // 1. Verify Teacher
  const teacher = await Teacher.findOne({ email: user.email });
  if (!teacher) throw new ApiError(404, "Teacher profile not found");

  // 2. Find Section by Name
  const section = await Section.findOne({ SectionName: sectionName })
      .populate("Student.Reg_No");
  
  if (!section) throw new ApiError(404, `Section '${sectionName}' not found`);

  // 3. Prepare Date
  const targetDate = new Date(date);
  const dayName = targetDate.toLocaleDateString("en-US", { weekday: 'long', timeZone: "Asia/Kolkata" });

  // 4. Create Sessions (Loop through slots)
  const createdSessions = [];

  for (const start of timeSlots) {
      const end = calculateEndTime(start);

      // SIMPLE CONFLICT CHECK: Is this specific section busy?
      const clash = await Attendance.findOne({
          section: section._id,
          date: targetDate,
          $or: [{ startTime: { $lt: end }, endTime: { $gt: start } }]
      });

      if (clash) {
          // We skip the clash or throw error depending on preference. 
          // Here we throw to alert the user immediately.
          throw new ApiError(409, `Clash! ${sectionName} is busy from ${clash.startTime} to ${clash.endTime}.`);
      }

      // Create Session
      const session = await Attendance.create({
          section: section._id,
          course: section.Course,
          markedBy: teacher._id,
          
          date: targetDate,
          day: dayName, 
          startTime: start,
          endTime: end,
          roomNo: section.RoomNo,
          
          students: section.Student.map(s => s.Reg_No ? ({ 
              student: s.Reg_No._id, status: "absent" 
          }) : null).filter(Boolean),
          
          isExtraClass: true
      });
      createdSessions.push(session);
  }

  res.status(200).json({
      success: true,
      message: `Successfully created ${createdSessions.length} extra class(es) for ${sectionName}`,
      date: date
  });
});

/* ============================================================
   🔄 ADD PERMANENT SLOT (Repeat Option)
   Action: Updates the 'Section' document permanently.
   Body: { "sectionId": "...", "day": "Monday", "startTime": "10:00", "endTime": "11:00" }
============================================================ */
export const addPermanentSlot = asyncHandler(async (req, res) => {
  const user = req.user;
  
  // 1. INPUT: No endTime needed!
  // days: ["Monday", "Wednesday", "Friday"]
  const { sectionName, days, startTime } = req.body;

  if (!days || !Array.isArray(days) || days.length === 0) {
      throw new ApiError(400, "Please provide a list of days (e.g., ['Monday'])");
  }

  // 2. Auto-Calculate End Time
  const endTime = calculateEndTime(startTime);

  // 3. Verify Teacher
  const teacher = await Teacher.findOne({ email: user.email });
  if (!teacher) throw new ApiError(404, "Teacher not found");

  // 4. Find Section (Unique Name)
  const section = await Section.findOne({ SectionName: sectionName });
  if (!section) throw new ApiError(404, `Section '${sectionName}' not found`);

  // 5. Security: Only the Owner can edit
  if (section.Teacher.toString() !== teacher._id.toString()) {
      return res.status(403).json({
          success: false,
          message: "You can only edit permanent slots for your own sections."
      });
  }

  // 6. LOOP & ADD
  let addedCount = 0;

  days.forEach(day => {
      // Check if slot already exists to prevent duplicates
      const exists = section.Day.some(slot => 
          slot.Day.includes(day) && slot.startTime === startTime
      );

      if (!exists) {
          section.Day.push({
              Day: [day], // Schema expects an array of strings
              startTime: startTime,
              endTime: endTime // 👈 Auto-filled (e.g., "10:50")
          });
          addedCount++;
      }
  });

  if (addedCount === 0) {
      return res.status(400).json({
          success: false,
          message: `Time slot ${startTime} already exists for all selected days.`
      });
  }

  await section.save();

  res.status(200).json({
      success: true,
      message: `Added class at ${startTime} - ${endTime} for [${days.join(", ")}]`,
      section: sectionName
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