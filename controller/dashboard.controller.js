import { asyncHandler } from "../asyncHandler.js";
import { Teacher } from "../modules/Teacher.js";
import { Student } from "../modules/Student.js";
import { Section } from "../modules/Section.js";
import { Attendance } from "../modules/Attendance.js";

/* ============================================================
   🇮🇳 IST DATE & DAY UTILITIES (SAFE & STABLE)
============================================================ */

// Returns today's date at IST midnight (00:00)
const getISTDate = () => {
  const now = new Date();
  const ist = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
  ist.setHours(0, 0, 0, 0);
  return ist;
};
const formatTimeIST = (timeValue) => {
  if (typeof timeValue === 'string' && timeValue.includes(':')) return timeValue;
  return new Date(timeValue).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
};

// Returns day name in IST (e.g., "Friday")
const getISTDayName = () => {
  return new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    timeZone: "Asia/Kolkata"
  });
};

/* ============================================================
   👨‍🏫 TEACHER DASHBOARD
   - Auto creates attendance
   - Auto syncs time if timetable changes
   - No duplicates
============================================================ */

export const getTeacherDashboard = asyncHandler(async (req, res) => {
  const user = req.user;

  const todayDate = getISTDate();
  const todayName = getISTDayName();

  // 1️⃣ Find teacher
  const teacher = await Teacher.findOne({ email: user.email });
  if (!teacher) {
    return res.status(200).json({
      success: true,
      role: "teacher",
      schedule: []
    });
  }

  // 2️⃣ Get today's sections for teacher
  const sections = await Section.find({
    Teacher: teacher._id,
    "Day.Day": todayName
  }).populate("Student.Reg_No");

  // 3️⃣ Create / Sync Attendance
  for (const sec of sections) {
    const todaySlots = sec.Day.filter(d => d.Day.includes(todayName));

    for (const slot of todaySlots) {
      let session = await Attendance.findOne({
        section: sec._id,
        date: todayDate
      });

      // 🔄 SYNC EXISTING SESSION
      if (session) {
        let updated = false;

        if (session.startTime !== slot.startTime) {
          session.startTime = slot.startTime;
          updated = true;
        }

        if (session.endTime !== slot.endTime) {
          session.endTime = slot.endTime;
          updated = true;
        }

        if (session.roomNo !== sec.RoomNo) {
          session.roomNo = sec.RoomNo;
          updated = true;
        }

        if (updated) await session.save();
        continue;
      }

      // 🆕 CREATE NEW SESSION
      const students = sec.Student
        .filter(s => s.Reg_No)
        .map(s => ({
          student: s.Reg_No._id,
          status: "absent",
          faceRecognition: { verified: false }
        }));

      await Attendance.create({
        section: sec._id,
        course: sec.Course,
        markedBy: teacher._id,
        date: todayDate,
        day: todayName,
        startTime: slot.startTime,
        endTime: slot.endTime,
        roomNo: sec.RoomNo,
        students,
        isLocked: false
      });
    }
  }

  // 4️⃣ Reload sessions after create/sync
  const sessions = await Attendance.find({
    markedBy: teacher._id,
    date: todayDate
  })
    .populate("course", "CourseName courseCode")
    .populate("section", "SectionName RoomNo");

  // 5️⃣ Format response
  const schedule = sessions
    .map(session => ({
      lecture_id: session._id,
      subject: session.course?.CourseName || "Unknown Course",
      courseCode: session.course?.courseCode || "",
      section_name: session.section?.SectionName,
      time: `${session.startTime} - ${session.endTime}`,
      room: session.roomNo,
      status: session.isLocked ? "Completed" : "Scheduled",
      totalStudents: session.students.length,
      presentCount: session.students.filter(
        s => s.status === "present"
      ).length
    }))
    .sort((a, b) => a.time.localeCompare(b.time));

  return res.status(200).json({
    success: true,
    role: "teacher",
    teacherName: teacher.name,
    date: todayDate.toDateString(),
    day: todayName,
    count: schedule.length,
    schedule
  });
});

/* ============================================================
   👨‍🎓 STUDENT DASHBOARD
   - Reads static timetable (Section)
   - No attendance mutation
============================================================ */
export const getStudentDashboard = asyncHandler(async (req, res) => {
  const user = req.user;
  
  // 1. DETERMINE DATE (Query Param or Default to Today)
  let targetDate;
  if (req.query.date) {
     targetDate = new Date(req.query.date); // e.g., "2026-01-15"
  } else {
     targetDate = getISTDate();
  }
  
  // Normalize to Midnight for DB matching
  targetDate.setHours(0, 0, 0, 0); 

  // 2. Get Day Name (e.g., "Monday") from the TARGET DATE
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const targetDayName = days[targetDate.getDay()];

  // 3. Find Student
  const student = await Student.findOne({ email: user.email });
  if (!student) return res.status(200).json({ success: true, schedule: [] });

  // 4. Find Sections (Based on the Day of the Requested Date)
  const sections = await Section.find({
    "Student.Reg_No": student._id,
    "Day.Day": targetDayName // 👈 Check if they had class on THAT day
  })
  .populate("Course", "CourseName courseCode")
  .populate("Teacher", "name");

  // 5. Fetch Attendance Sessions for TARGET DATE
  const sectionIds = sections.map(sec => sec._id);
  const existingSessions = await Attendance.find({
    date: targetDate, // 👈 Look for records on THAT date
    section: { $in: sectionIds } 
  });

  let schedule = [];

  sections.forEach((sec) => {
    // Filter slots for the specific day
    const daySlots = sec.Day.filter(d => d.Day.includes(targetDayName));

    daySlots.forEach(slot => {
      // Check for session match
      const activeSession = existingSessions.find(s => 
        s.section.toString() === sec._id.toString() && 
        // Compare Hours (Simple integer match)
        new Date(s.startTime).getHours() === parseInt(slot.startTime.split(':')[0])
      );

      let myStatus = "Pending"; 
      
      // If viewing a PAST date and no session exists, it means the class didn't happen
      if (!activeSession && targetDate < getISTDate().setHours(0,0,0,0)) {
           myStatus = "No Record"; 
      }

      if (activeSession) {
          const myRecord = activeSession.students.find(s => 
              s.student.toString() === student._id.toString()
          );
          if (myRecord) {
              myStatus = myRecord.status.charAt(0).toUpperCase() + myRecord.status.slice(1);
          }
      }

      // Format Times
      const startStr = formatTimeIST(slot.startTime); 
      const endStr = formatTimeIST(slot.endTime);

      schedule.push({
        id: sec._id,
        subject: sec.Course?.CourseName || "Unknown",
        courseCode: sec.Course?.courseCode || "",
        teacher: sec.Teacher?.name || "TBD",
        time: `${startStr} - ${endStr}`,
        room: sec.RoomNo,
        status: myStatus 
      });
    });
  });

  schedule.sort((a, b) => a.time.localeCompare(b.time));

  return res.status(200).json({
    success: true,
    role: "student",
    studentName: student.name,
    date: targetDate.toDateString(),
    day: targetDayName,
    count: schedule.length,
    schedule
  });
});