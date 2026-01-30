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
import { Course } from "../modules/Course.js";
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

// 1. Get Date without time (UTC Midnight)
const getNormalizedDate = (inputDate) => {
    const d = inputDate ? new Date(inputDate) : new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};

// 2. Get Day Name (e.g., "Friday")
const getDayName = (dateObj) => {
    return dateObj.toLocaleDateString("en-US", { weekday: 'long', timeZone: "Asia/Kolkata" });
};

// 3. Add 50 minutes (Math-based, Timezone Safe) 🛡️ FIXED
const calculateEndTime = (startTime) => {
    let [hours, minutes] = startTime.split(':').map(Number);
    
    // Add 50 minutes
    minutes += 50;
    
    // Handle overflow (e.g., 60+ minutes)
    if (minutes >= 60) {
        hours += 1;
        minutes -= 60;
    }
    
    // Handle midnight wrap-around (optional, but good safety)
    if (hours >= 24) hours = 0;

    // Format back to "HH:MM"
    const hStr = hours.toString().padStart(2, '0');
    const mStr = minutes.toString().padStart(2, '0');
    
    return `${hStr}:${mStr}`;
};

// 4. Map Day (MON -> Monday)
const mapDayToFull = (shortDay) => {
    const map = { "MON": "Monday", "TUE": "Tuesday", "WED": "Wednesday", "THU": "Thursday", "FRI": "Friday", "SAT": "Saturday" };
    return map[shortDay.toUpperCase()] || shortDay;
};


/* ============================================================
   1️⃣ AD-HOC SESSION (Temporary Class)
   - Creates a one-time class in Attendance
============================================================ */
export const createAdHocSession = asyncHandler(async (req, res) => {
    const { courseName, section, date, timeSlots } = req.body;

    const teacher = await Teacher.findOne({ email: req.user.email });
    if (!teacher) throw new ApiError(404, "Teacher profile not found");

    const courseDoc = await Course.findOne({ CourseName: { $regex: new RegExp(courseName, "i") } });
    if (!courseDoc) throw new ApiError(404, "Course not found");

    const sectionDoc = await Section.findOne({ SectionName: section, Course: courseDoc._id }).populate("Student.Reg_No");
    if (!sectionDoc) throw new ApiError(404, "Section not found");

    const targetDate = getNormalizedDate(date);
    const dayName = getDayName(targetDate);

    for (const start of timeSlots) {
        const end = calculateEndTime(start);

        // Check for room clash
        const clash = await Attendance.findOne({
            roomNo: sectionDoc.RoomNo,
            date: targetDate,
            startTime: start
        });
        if (clash) throw new ApiError(409, `Room ${sectionDoc.RoomNo} is occupied at ${start}`);

        await Attendance.create({
            section: sectionDoc._id,
            course: courseDoc._id,
            markedBy: teacher._id,
            date: targetDate,
            day: dayName,
            startTime: start,
            endTime: end,
            roomNo: sectionDoc.RoomNo,
            students: sectionDoc.Student.map(s => s.Reg_No ? { student: s.Reg_No._id, status: "absent" } : null).filter(Boolean),
            isExtraClass: true
        });
    }

    res.status(200).json({ success: true, message: "Ad-hoc session created successfully" });
});


/* ============================================================
   2️⃣ PERMANENT CLASS (Link / Copy)
   - Copies timetable from 'section' (Source) to 'mySection' (Destination)
============================================================ */
export const addPermanentSlot = asyncHandler(async (req, res) => {
    const user = req.user;
    
    // 1. INPUT: Simple details
    const { year, courseName, section } = req.body;

    // 2. FIND TEACHER (You)
    const teacher = await Teacher.findOne({ email: user.email });
    if (!teacher) throw new ApiError(404, "Teacher profile not found");

    // 3. FIND COURSE
    // Regex allows "daa" to match "DAA" or "Design & Analysis..."
    const courseDoc = await Course.findOne({ 
        CourseName: { $regex: new RegExp(courseName, "i") } 
    });
    if (!courseDoc) throw new ApiError(404, `Course '${courseName}' not found.`);

    // 4. FIND SECTION
    const sectionDoc = await Section.findOne({ 
        SectionName: section, 
        Course: courseDoc._id 
    });

    if (!sectionDoc) throw new ApiError(404, `Section '${section}' for course '${courseName}' not found.`);

    // 5. THE LOGIC: ADD TEACHER TO ARRAY
    // Check if you are already added to avoid duplicates
    if (sectionDoc.Teacher.includes(teacher._id)) {
        return res.status(200).json({
            success: true,
            message: `You are already assigned to ${courseName} - Section ${section}.`
        });
    }

    // Push your ID into the array
    sectionDoc.Teacher.push(teacher._id);
    await sectionDoc.save();

    res.status(200).json({
        success: true,
        message: `Success! You have been added as a teacher for ${courseName} (Section ${section}).`,
        data: {
            section: section,
            course: courseName,
            totalTeachers: sectionDoc.Teacher.length
        }
    });
});
/*=============
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