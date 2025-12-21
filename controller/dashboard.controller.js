import { asyncHandler } from "../asyncHandler.js";
import { Teacher } from "../modules/Teacher.js";
import { Student } from "../modules/Student.js";
import { Section } from "../modules/Section.js"; // Your Section model

/* ------------------------------------------------------------
   🗓️ Utility: Get Current Day Name (e.g., "Wednesday")
------------------------------------------------------------ */
const getCurrentDayName = () => {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[new Date().getDay()];
};

/* ------------------------------------------------------------
   👨‍🏫 TEACHER DASHBOARD
   Logic: User Email -> Teacher Profile -> Find Sections -> Filter Today's Slot
------------------------------------------------------------ */
export const getTeacherDashboard = asyncHandler(async (req, res) => {
  const user = req.user;
  const todayName = getCurrentDayName(); 

  // 1️⃣ BRIDGE: Find Teacher Profile using Email
  const teacherProfile = await Teacher.findOne({ email: user.email });

  if (!teacherProfile) {
    return res.status(200).json({ 
      success: true, 
      message: "Teacher profile not found for this user.", 
      schedule: [] 
    });
  }

  // 2️⃣ QUERY: Find Sections linked to this Teacher that meet on 'todayName'
  const sections = await Section.find({
    Teacher: teacherProfile._id,   
    "Day.Day": todayName           // Checks if "Wednesday" is inside the Day array
  })
  .populate("Course", "CourseName courseCode")
  .populate("Teacher", "name");

  // 3️⃣ FILTER: Extract only the specific time slot for today
  let schedule = [];

  sections.forEach((sec) => {
    // A section might meet Mon 9am and Wed 2pm. We only want today's slot.
    const todaySlots = sec.Day.filter(d => d.Day.includes(todayName));

    todaySlots.forEach(slot => {
      schedule.push({
        Section_id: sec._id,             // Useful for clicking into the class
        subject: sec.Course?.CourseName || "Unknown Course", // issue 
        courseCode: sec.Course?.courseCode || "",
        section_name: sec.SectionName,
        time: `${slot.startTime} - ${slot.endTime}`,
        Building: sec.Building,
        room: sec.RoomNo,
        status: slot.completed === "NA" ? "Scheduled" : "Completed",
        totalStudents: sec.Student.length
      });
    });
  });

  // 4️⃣ SORT: Order by start time (e.g., 09:00 before 14:00)
  schedule.sort((a, b) => a.time.localeCompare(b.time));

  return res.status(200).json({
    success: true,
    role: "teacher",
    teacherName: teacherProfile.name,
    date: new Date().toDateString(),
    day: todayName,
    count: schedule.length,
    schedule
  });
});

/* ------------------------------------------------------------
   👨‍🎓 STUDENT DASHBOARD
   Logic: User Email -> Student Profile -> Find Sections -> Filter Today's Slot
------------------------------------------------------------ */
export const getStudentDashboard = asyncHandler(async (req, res) => {
  const user = req.user;
  const todayName = getCurrentDayName();

  // 1️⃣ BRIDGE: Find Student Profile using Email
  const studentProfile = await Student.findOne({ email: user.email });

  if (!studentProfile) {
    return res.status(200).json({ 
      success: true, 
      message: "Student profile not found.", 
      schedule: [] 
    });
  }

  // 2️⃣ CHECK ENROLLMENT: In your new Schema, Students are inside the Section
  // So we find Sections where the Student Array contains this Student's ID
  const sections = await Section.find({
    "Student.Reg_No": studentProfile._id, // Look inside the Student array
    "Day.Day": todayName
  })
  .populate("Course", "CourseName courseCode")
  .populate("Teacher", "name");

  // 3️⃣ FILTER & FORMAT
  let schedule = [];

  sections.forEach((sec) => {
    const todaySlots = sec.Day.filter(d => d.Day.includes(todayName));

    todaySlots.forEach(slot => {
      schedule.push({
        id: sec._id,
        subject: sec.Course?.CourseName || "Unknown Course",
        courseCode: sec.Course?.courseCode || "",
        teacher: sec.Teacher?.name || "TBD",
        time: `${slot.startTime} - ${slot.endTime}`,
        room: sec.RoomNo,
        status: "Pending" // You will implement real status later via Attendance model
      });
    });
  });

  // 4️⃣ SORT
  schedule.sort((a, b) => a.time.localeCompare(b.time));

  return res.status(200).json({
    success: true,
    role: "student",
    studentName: studentProfile.name,
    date: new Date().toDateString(),
    day: todayName,
    count: schedule.length,
    schedule
  });
});