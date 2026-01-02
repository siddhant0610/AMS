import { asyncHandler } from "../asyncHandler.js";
import { Teacher } from "../modules/Teacher.js";
import { Student } from "../modules/Student.js";
import { Section } from "../modules/Section.js";

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
   👨‍🏫 TEACHER DASHBOARD
============================================================ */
export const getTeacherDashboard = asyncHandler(async (req, res) => {
  const user = req.user;
  
  // ✅ FIX: Get the day name according to INDIA
  const todayName = getIndiaDayName(); 

  // 1️⃣ BRIDGE: Find Teacher Profile
  const teacherProfile = await Teacher.findOne({ email: user.email });

  if (!teacherProfile) {
    return res.status(200).json({ 
      success: true, 
      message: "Teacher profile not found for this user.", 
      schedule: [] 
    });
  }

  // 2️⃣ QUERY: Find Sections for Today
  const sections = await Section.find({
    Teacher: teacherProfile._id,   
    "Day.Day": todayName           
  })
  .populate("Course", "CourseName courseCode")
  .populate("Teacher", "name");

  // 3️⃣ FILTER & FORMAT
  let schedule = [];

  sections.forEach((sec) => {
    // Filter specifically for today's slot(s)
    const todaySlots = sec.Day.filter(d => d.Day.includes(todayName));

    todaySlots.forEach(slot => {
      // ✅ FIX: Format times to avoid UTC confusion
      const startTime = formatTimeIST(slot.startTime);
      const endTime = formatTimeIST(slot.endTime);

      schedule.push({
        Section_id: sec._id,            
        subject: sec.Course?.CourseName || "Unknown Course",
        courseCode: sec.Course?.courseCode || "",
        section_name: sec.SectionName,
        
        // Time is now safe & clean
        time: `${startTime} - ${endTime}`,
        
        Building: sec.Building,
        room: sec.RoomNo,
        status: slot.completed === "NA" ? "Scheduled" : "Completed",
        totalStudents: sec.Student.length
      });
    });
  });

  // 4️⃣ SORT: Earliest class first
  schedule.sort((a, b) => a.time.localeCompare(b.time));

  return res.status(200).json({
    success: true,
    role: "teacher",
    teacherName: teacherProfile.name,
    date: getIndiaDate().toDateString(), // ✅ FIX: Send IST Date string
    day: todayName,
    count: schedule.length,
    schedule
  });
});

/* ============================================================
   👨‍🎓 STUDENT DASHBOARD
============================================================ */
export const getStudentDashboard = asyncHandler(async (req, res) => {
  const user = req.user;
  
  // ✅ FIX: Get the day name according to INDIA
  const todayName = getIndiaDayName();

  // 1️⃣ BRIDGE: Find Student Profile
  const studentProfile = await Student.findOne({ email: user.email });

  if (!studentProfile) {
    return res.status(200).json({ 
      success: true, 
      message: "Student profile not found.", 
      schedule: [] 
    });
  }

  // 2️⃣ CHECK ENROLLMENT: Find Sections containing this Student
  const sections = await Section.find({
    "Student.Reg_No": studentProfile._id,
    "Day.Day": todayName
  })
  .populate("Course", "CourseName courseCode")
  .populate("Teacher", "name");

  // 3️⃣ FILTER & FORMAT
  let schedule = [];

  sections.forEach((sec) => {
    const todaySlots = sec.Day.filter(d => d.Day.includes(todayName));

    todaySlots.forEach(slot => {
      // ✅ FIX: Format times
      const startTime = formatTimeIST(slot.startTime);
      const endTime = formatTimeIST(slot.endTime);

      schedule.push({
        id: sec._id,
        subject: sec.Course?.CourseName || "Unknown Course",
        courseCode: sec.Course?.courseCode || "",
        teacher: sec.Teacher?.name || "TBD",
        
        // Time is now safe & clean
        time: `${startTime} - ${endTime}`,
        
        room: sec.RoomNo,
        status: "Pending" 
      });
    });
  });

  // 4️⃣ SORT
  schedule.sort((a, b) => a.time.localeCompare(b.time));

  return res.status(200).json({
    success: true,
    role: "student",
    studentName: studentProfile.name,
    date: getIndiaDate().toDateString(), // ✅ FIX: Send IST Date string
    day: todayName,
    count: schedule.length,
    schedule
  });
});