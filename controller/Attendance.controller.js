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
/**
 * Maps short day codes to full day names.
 * "MON" -> "Monday"
 */
const mapDayToFull = (shortDay) => {
    const map = {
        "MON": "Monday", "TUE": "Tuesday", "WED": "Wednesday", 
        "THU": "Thursday", "FRI": "Friday", "SAT": "Saturday", "SUN": "Sunday"
    };
    return map[shortDay.toUpperCase()] || shortDay;
};


// =========================================================================
// 1️⃣ AD-HOC SESSION (Temporary Class)
// =========================================================================
export const createAdHocSession = asyncHandler(async (req, res) => {
    const teacher = req.user;
    
    // 1. INPUT VALIDATION
    const { year, branch, courseName, section, date, timeSlots } = req.body;

   
    if (!date || !timeSlots || !Array.isArray(timeSlots) || timeSlots.length === 0) {
        throw new ApiError(400, "Date and timeSlots (array) are required.");
    }

    // 2. FIND COURSE (Case-Insensitive Regex)
    const courseDoc = await Course.findOne({ 
        CourseName: { $regex: new RegExp(courseName, "i") } 
        // Optional: Add 'branch' or 'year' filter here if your schema allows
    });
    if (!courseDoc) throw new ApiError(404, `Course '${courseName}' not found.`);

    // 3. FIND SECTION (Unique identifier: Name + Course)
    const sectionDoc = await Section.findOne({ 
        SectionName: section,
        Course: courseDoc._id
    }).populate("Student.Reg_No");

    if (!sectionDoc) throw new ApiError(404, `Section '${section}' not found.`);

    // 4. PREPARE SESSION DATA
    const targetDate = new Date(date);
    const dayName = targetDate.toLocaleDateString("en-US", { weekday: 'long', timeZone: "Asia/Kolkata" });
    const createdSessions = [];

    // 5. PROCESS SLOTS LOOP
    for (const start of timeSlots) {
        // Auto-calculate End Time (50 mins)
        const end = calculateEndTime(start);

        // 🚨 ROOM COLLISION CHECK
        // Check if ANY class exists in this room during this time window
        const roomClash = await Attendance.findOne({
            roomNo: sectionDoc.RoomNo,
            date: targetDate,
            $or: [
                { startTime: { $lt: end }, endTime: { $gt: start } } // Overlap Formula
            ]
        });

        if (roomClash) {
            // Option: Throw error or skip. We throw error to alert the user.
            throw new ApiError(409, `Room ${sectionDoc.RoomNo} is busy at ${start} (Occupied by another class).`);
        }

        // ✅ CREATE SESSION
        const newSession = await Attendance.create({
            section: sectionDoc._id,
            course: courseDoc._id,
            markedBy: teacher._id, // The logged-in teacher creating the extra class
            
            date: targetDate,
            day: dayName,
            startTime: start,
            endTime: end,
            roomNo: sectionDoc.RoomNo,
            
            // Map students to attendance array
            students: sectionDoc.Student.map(s => s.Reg_No ? ({ 
                student: s.Reg_No._id, status: "absent" 
            }) : null).filter(Boolean),
            
            isExtraClass: true
        });

        createdSessions.push(newSession);
    }

    res.status(200).json({
        success: true,
        message: `Successfully created ${createdSessions.length} temporary session(s).`,
        data: {
            date: date,
            section: section,
            times: timeSlots
        }
    });
});


// =========================================================================
// 2️⃣ PERMANENT CLASS (Link / Sync Logic)
// =========================================================================
export const linkPermanentClass = asyncHandler(async (req, res) => {
    const user = req.user;

    // 1. INPUT VALIDATION
    // 'section' = Target (Source)
    // 'mySection' = Your Section (Destination)
    const { courseName, section, classType, days, mySection } = req.body;

    if (classType !== 'permanent') {
        throw new ApiError(400, "Invalid classType. For this endpoint, use 'permanent'.");
    }
    if (!days || !Array.isArray(days) || !mySection) {
        throw new ApiError(400, "Days array and 'mySection' name are required.");
    }

    // 2. FIND COURSE
    const courseDoc = await Course.findOne({ 
        CourseName: { $regex: new RegExp(courseName, "i") } 
    });
    if (!courseDoc) throw new ApiError(404, `Course '${courseName}' not found.`);

    // 3. FIND TARGET SECTION (SOURCE)
    const targetSectionDoc = await Section.findOne({ 
        SectionName: section, 
        Course: courseDoc._id 
    });
    if (!targetSectionDoc) throw new ApiError(404, `Target Section '${section}' (Source) not found.`);

    // 4. FIND MY SECTION (DESTINATION)
    const mySectionDoc = await Section.findOne({
        SectionName: mySection,
        Course: courseDoc._id
    });
    if (!mySectionDoc) throw new ApiError(404, `Your Section '${mySection}' (Destination) not found.`);

    // 5. AUTH CHECK (Only Owner can update their section)
    const teacher = await Teacher.findOne({ email: user.email });
    if (mySectionDoc.Teacher.toString() !== teacher._id.toString()) {
        throw new ApiError(403, "You can only update the timetable for your own section.");
    }

    // 6. SYNC LOOP
    let syncedCount = 0;

    days.forEach(shortDay => {
        const fullDay = mapDayToFull(shortDay); // "MON" -> "Monday"

        // A. Find classes in Target for this day
        const targetSlots = targetSectionDoc.Day.filter(s => s.Day.includes(fullDay));

        if (targetSlots.length === 0) {
            // Logic: "if not present on that day, reject it" -> We simply skip.
            return;
        }

        // B. Copy valid slots
        targetSlots.forEach(tSlot => {
            // Check for existing slot in My Section (Avoid Duplicates)
            const alreadyExists = mySectionDoc.Day.some(mSlot => 
                mSlot.Day.includes(fullDay) && mSlot.startTime === tSlot.startTime
            );

            if (!alreadyExists) {
                mySectionDoc.Day.push({
                    Day: [fullDay], 
                    startTime: tSlot.startTime, // Sync Start
                    endTime: tSlot.endTime      // Sync End (Copy exact duration)
                });
                syncedCount++;
            }
        });
    });

    if (syncedCount === 0) {
        return res.status(400).json({
            success: false,
            message: "No new slots added. Either the target has no classes on these days, or you are already synced."
        });
    }

    await mySectionDoc.save();

    res.status(200).json({
        success: true,
        message: `Synced! Copied ${syncedCount} slots from ${section} to ${mySection}.`,
        data: {
            days: days,
            source: section,
            destination: mySection
        }
    });
});
// export const linkPermanentClass = asyncHandler(async (req, res) => {
//     const user = req.user;
//     const { courseName, section, classType, days, mySection } = req.body;

//     // 1. Find Course
//     const courseDoc = await Course.findOne({ 
//         CourseName: { $regex: new RegExp(courseName, "i") } 
//     });
    
//     if (!courseDoc) throw new ApiError(404, `DEBUG: Course with name '${courseName}' not found.`);

//     console.log("------------------------------------------------");
//     console.log(`🔎 SEARCHING FOR: ${courseName}`);
//     console.log(`✅ FOUND COURSE ID: ${courseDoc._id.toString()}`);
//     console.log("------------------------------------------------");

//     // 2. Try to Find YOUR Section (Destination)
//     const mySectionDoc = await Section.findOne({
//         SectionName: mySection
//     });

//     if (!mySectionDoc) {
//         throw new ApiError(404, `DEBUG: Section '${mySection}' does not exist at all.`);
//     }

//     console.log(`📂 SECTION '${mySection}' EXISTS.`);
//     console.log(`🔗 IT IS LINKED TO COURSE ID: ${mySectionDoc.Course.toString()}`);
//     console.log("------------------------------------------------");

//     // 3. CHECK MATCH
//     if (mySectionDoc.Course.toString() !== courseDoc._id.toString()) {
//         throw new ApiError(409, `⚠️ MISMATCH! \nRequest Found Course: ${courseDoc._id} \nSection is Linked to: ${mySectionDoc.Course} \n\nSolution: Check the exact Course Name in DB.`);
//     }

//     // ... (Rest of the controller if match is successful) ...
//     res.status(200).json({ success: true, message: "Debug complete. Check console logs." });
// });
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