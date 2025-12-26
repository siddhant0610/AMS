import { asyncHandler } from "../asyncHandler.js";
import { ApiError } from "../utils/api.Error.js";
import { Teacher } from "../modules/Teacher.js";
import { Student } from "../modules/Student.js";
import { Section } from "../modules/Section.js"; 
// 👇 NEW IMPORT: Needed to create the sessions
import { Attendance } from "../modules/Attendance.js"; 

/* ------------------------------------------------------------
   🗓️ Utility: Get Current Day Name (e.g., "Wednesday")
------------------------------------------------------------ */
const getCurrentDayName = (date) => {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[date.getDay()];
};

/* ------------------------------------------------------------
   👨‍🏫 TEACHER DASHBOARD (Strategy B: Auto-Create Logic)
------------------------------------------------------------ */
export const getTeacherDashboard = asyncHandler(async (req, res) => {
  const user = req.user;
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Start of today (Midnight)
  const todayName = getCurrentDayName(today); 

  // 1️⃣ BRIDGE: Find Teacher Profile
  const teacherProfile = await Teacher.findOne({ email: user.email });

  if (!teacherProfile) {
    return res.status(200).json({ success: true, message: "Teacher profile not found.", schedule: [] });
  }

  // 2️⃣ CHECK: Do buckets (Attendance Docs) already exist for today?
  let todaySessions = await Attendance.find({
    markedBy: teacherProfile._id,
    date: today
  })
  .populate("course", "CourseName courseCode") // Matches your Schema refs
  .populate("section", "SectionName RoomNo");

  // 3️⃣ AUTO-CREATE: If list is empty, generate from Static Schedule
  if (todaySessions.length === 0) {
    console.log(`⚡ Generating attendance sessions for ${teacherProfile.name}...`);

    // A. Find the Static Schedule (Sections meeting today)
    const sections = await Section.find({
      Teacher: teacherProfile._id,   
      "Day.Day": todayName           
    }).populate("Student.Reg_No"); // Need student list to initialize attendance

    const newSessions = [];

    // B. Loop through sections and create "Attendance" documents
    for (const sec of sections) {
      // Filter: Only get today's specific time slot
      const validSlots = sec.Day.filter(d => d.Day.includes(todayName));

      for (const slot of validSlots) {
        // Double-check: Prevent duplicates
        const exists = await Attendance.findOne({
           section: sec._id, date: today, startTime: slot.startTime 
        });
        if (exists) continue;

        // Initialize empty student records
        const studentRecords = sec.Student.map(s => ({
          student: s.Reg_No._id,
          status: "absent", // Default status
          faceRecognition: { verified: false }
        }));

        // Create the Session
        const session = await Attendance.create({
          section: sec._id,
          course: sec.Course, // Assumes Section has Course ID
          markedBy: teacherProfile._id,
          date: today,
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

    // C. Refresh the list to return the newly created docs
    if (newSessions.length > 0) {
       todaySessions = await Attendance.find({
          markedBy: teacherProfile._id,
          date: today
       })
       .populate("course", "CourseName courseCode")
       .populate("section", "SectionName RoomNo");
    }
  }

  // 4️⃣ FORMAT RESPONSE
  // ⚠️ CRITICAL: We map 'id' to the ATTENDANCE ID, not the Section ID
  const schedule = todaySessions.map((session) => ({
    id: session._id, // <--- Used for Face Upload Route
    sectionId: session.section?._id, // Keep reference just in case
    subject: session.course?.CourseName || session.course?.courseName || "Unknown Course",
    courseCode: session.course?.courseCode || "",
    section_name: session.section?.SectionName,
    time: `${session.startTime} - ${session.endTime}`,
    room: session.roomNo,
    // If locked, it's "Completed". If not, it's "Scheduled"
    status: session.isLocked ? "Completed" : "Scheduled",
    totalStudents: session.students.length,
    presentCount: session.totalPresent || 0
  }));

  // 5️⃣ SORT by Time
  schedule.sort((a, b) => a.time.localeCompare(b.time));

  return res.status(200).json({
    success: true,
    role: "teacher",
    teacherName: teacherProfile.name,
    date: today.toDateString(),
    day: todayName,
    count: schedule.length,
    schedule
  });
});

/* ------------------------------------------------------------
   👨‍🎓 STUDENT DASHBOARD
   (Remains mostly the same, reading from Static Schedule)
------------------------------------------------------------ */
export const getStudentDashboard = asyncHandler(async (req, res) => {
  const user = req.user;
  const today = new Date();
  const todayName = getCurrentDayName(today);

  // 1️⃣ BRIDGE
  const studentProfile = await Student.findOne({ email: user.email });

  if (!studentProfile) {
    return res.status(200).json({ success: true, message: "Student profile not found.", schedule: [] });
  }

  // 2️⃣ QUERY SECTIONS
  const sections = await Section.find({
    "Student.Reg_No": studentProfile._id,
    "Day.Day": todayName
  })
  .populate("Course", "CourseName courseCode")
  .populate("Teacher", "name");

  // 3️⃣ FORMAT
  let schedule = [];

  sections.forEach((sec) => {
    const todaySlots = sec.Day.filter(d => d.Day.includes(todayName));

    todaySlots.forEach(slot => {
      schedule.push({
        id: sec._id,
        subject: sec.Course?.CourseName || sec.Course?.courseName || "Unknown Course",
        courseCode: sec.Course?.courseCode || "",
        teacher: sec.Teacher?.name || "TBD",
        time: `${slot.startTime} - ${slot.endTime}`,
        room: sec.RoomNo,
        status: "Pending" // Student sees "Pending" until you link Real Attendance Data
      });
    });
  });

  schedule.sort((a, b) => a.time.localeCompare(b.time));

  return res.status(200).json({
    success: true,
    role: "student",
    studentName: studentProfile.name,
    date: today.toDateString(),
    day: todayName,
    count: schedule.length,
    schedule
  });
});