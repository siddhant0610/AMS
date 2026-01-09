import { asyncHandler } from "../asyncHandler.js";
import { ApiError } from "../utils/api.Error.js";
import { Teacher } from "../modules/Teacher.js";
import { Student } from "../modules/Student.js";
import { Section } from "../modules/Section.js"; 
// 👇 CRITICAL IMPORT: Needed to create the attendance sessions
import { Attendance } from "../modules/Attendance.js"; 

/* ============================================================
   🇮🇳 TIME UTILITIES (Fixes Time Zone Issues)
   Forces the server to think in "Asia/Kolkata" (IST)
============================================================ */

// 1. Get Current Date Object in IST
const getIndiaDate = () => {
  const indiaTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  return new Date(indiaTime);
};

// 2. Get Current Day Name in IST (e.g., "Friday")
const getIndiaDayName = () => {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[getIndiaDate().getDay()];
};

// 3. Format Database Time to "HH:MM" (IST)
const formatTimeIST = (timeValue) => {
  // If it's already a clean string like "10:00", keep it.
  if (typeof timeValue === 'string' && timeValue.includes(':')) return timeValue;

  // If it's a Date object (UTC), convert to IST string
  return new Date(timeValue).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false // Set to true if you want "02:00 pm"
  });
};

/* ============================================================
   👨‍🏫 TEACHER DASHBOARD (Auto-Create + IST Fix)
============================================================ */
export const getTeacherDashboard = asyncHandler(async (req, res) => {
  const user = req.user;
  
  // 🕒 1. Time Setup (IST)
  const todayName = getIndiaDayName(); // e.g., "Friday"
  const todayDate = getIndiaDate();    // Current IST Date
  todayDate.setHours(0, 0, 0, 0);      // Normalize to Midnight for DB consistency

  // 🌉 2. Find Teacher
  const teacherProfile = await Teacher.findOne({ email: user.email });
  if (!teacherProfile) {
    return res.status(200).json({ success: true, message: "Teacher not found", schedule: [] });
  }

  // 🔍 3. CHECK: Do sessions already exist for today?
  let todaySessions = await Attendance.find({
    markedBy: teacherProfile._id,
    date: todayDate // Checks for 00:00:00 today
  })
  .populate("course", "CourseName courseCode")
  .populate("section", "SectionName RoomNo");

  // 🚀 4. AUTO-CREATE (If list is empty, generate from Schedule)
  if (todaySessions.length === 0) {
    console.log(`⚡ Generating attendance sessions for ${teacherProfile.name} on ${todayName}...`);

    // A. Find Static Schedule for Today
    const sections = await Section.find({
      Teacher: teacherProfile._id,   
      "Day.Day": todayName           
    }).populate("Student.Reg_No"); // Need students to initialize the register

    const newSessions = [];

    // B. Loop and Create
    for (const sec of sections) {
      const todaySlots = sec.Day.filter(d => d.Day.includes(todayName));

      for (const slot of todaySlots) {
        // Double Check: Avoid duplicates
        const exists = await Attendance.findOne({
           section: sec._id, date: todayDate, startTime: slot.startTime 
        });
        if (exists) continue;

        // Prepare Student List (Default: Absent)
        const studentRecords = sec.Student.map(s => {
            if(!s.Reg_No) return null;
            return {
              student: s.Reg_No._id,
              status: "absent",
              faceRecognition: { verified: false }
            };
        }).filter(s => s !== null);

        // Create Session in DB
        const session = await Attendance.create({
          section: sec._id,
          course: sec.Course, 
          markedBy: teacherProfile._id,
          
          date: todayDate,  // Saving standardized IST Midnight date
          day: todayName,
          
          startTime: slot.startTime,
          endTime: slot.endTime,
          roomNo: sec.RoomNo,
          students: studentRecords,
          isLocked: false
        });
        
        newSessions.push(session);
      }
    }

    // C. Refresh List if we created new ones
    if (newSessions.length > 0) {
       todaySessions = await Attendance.find({
         markedBy: teacherProfile._id,
         date: todayDate
       })
       .populate("course", "CourseName courseCode")
       .populate("section", "SectionName RoomNo");
    }
  }

  // 📊 5. FORMAT RESPONSE
  const schedule = todaySessions.map((session) => {
    // Format Times correctly (IST)
    const startStr = formatTimeIST(session.startTime);
    const endStr = formatTimeIST(session.endTime);

    return {
      lecture_id: session._id, // <--- Used for Face Upload
      subject: session.course?.CourseName || session.course?.courseName || "Unknown Course",
      courseCode: session.course?.courseCode || "",
      section_name: session.section?.SectionName,
      
      // Clean Time Display
      time: `${startStr} - ${endStr}`,
      
      room: session.roomNo,
      status: session.isLocked ? "Completed" : "Scheduled",
      totalStudents: session.students.length,
      presentCount: session.totalPresent || 0
    };
  });

  // Sort by Time
  schedule.sort((a, b) => a.time.localeCompare(b.time));

  return res.status(200).json({
    success: true,
    role: "teacher",
    teacherName: teacherProfile.name,
    date: getIndiaDate().toDateString(),
    day: todayName,
    count: schedule.length,
    schedule
  });
});

/* ============================================================
   👨‍🎓 STUDENT DASHBOARD (Reads Static Schedule)
============================================================ */
export const getStudentDashboard = asyncHandler(async (req, res) => {
  const user = req.user;
  const todayName = getIndiaDayName();

  const studentProfile = await Student.findOne({ email: user.email });
  if (!studentProfile) {
    return res.status(200).json({ success: true, message: "Student not found", schedule: [] });
  }

  const sections = await Section.find({
    "Student.Reg_No": studentProfile._id,
    "Day.Day": todayName
  })
  .populate("Course", "CourseName courseCode")
  .populate("Teacher", "name");

  let schedule = [];

  sections.forEach((sec) => {
    const todaySlots = sec.Day.filter(d => d.Day.includes(todayName));

    todaySlots.forEach(slot => {
      const startStr = formatTimeIST(slot.startTime);
      const endStr = formatTimeIST(slot.endTime);

      schedule.push({
        id: sec._id,
        subject: sec.Course?.CourseName || "Unknown Course",
        courseCode: sec.Course?.courseCode || "",
        teacher: sec.Teacher?.name || "TBD",
        time: `${startStr} - ${endStr}`,
        room: sec.RoomNo,
        status: "Pending" 
      });
    });
  });

  schedule.sort((a, b) => a.time.localeCompare(b.time));

  return res.status(200).json({
    success: true,
    role: "student",
    studentName: studentProfile.name,
    date: getIndiaDate().toDateString(),
    day: todayName,
    count: schedule.length,
    schedule
  });
});