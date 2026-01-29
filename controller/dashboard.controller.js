import { asyncHandler } from "../asyncHandler.js";
import { Teacher } from "../modules/Teacher.js";
import { Student } from "../modules/Student.js";
import { Section } from "../modules/Section.js";
import { Attendance } from "../modules/Attendance.js";

/* ============================================================
   🇮🇳 IST DATE & DAY UTILITIES (SAFE & STABLE)
============================================================ */

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
    const todayDate = getNormalizedDate();
    const dayName = getDayName(todayDate);

    const teacher = await Teacher.findOne({ email: req.user.email });
    if (!teacher) return res.status(200).json({ success: true, schedule: [] });

    const sections = await Section.find({
        Teacher: teacher._id,
        "Day.Day": dayName
    }).populate("Student.Reg_No", "_id");

    // --- SYNC LOOP (Fixed with try-catch) ---
    for (const sec of sections) {
        const slots = sec.Day.filter(d => d.Day.includes(dayName));

        for (const slot of slots) {
            // A. Try to find existing session (Specific Time)
            let session = await Attendance.findOne({
                section: sec._id,
                date: todayDate,
                startTime: slot.startTime // <--- Important: Match exact time
            });

            if (session) {
                if (!session.isLocked && session.roomNo !== sec.RoomNo) {
                    session.roomNo = sec.RoomNo;
                    await session.save();
                }
                continue;
            }

            // B. Create if not found (CRASH PROOF)
            try {
                await Attendance.create({
                    section: sec._id,
                    course: sec.Course,
                    markedBy: teacher._id,
                    date: todayDate,
                    day: dayName,
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                    roomNo: sec.RoomNo,
                    students: sec.Student.map(s => s.Reg_No ? { student: s.Reg_No._id, status: "absent" } : null).filter(Boolean),
                    isExtraClass: false
                });
            } catch (error) {
                // If it exists but we missed it, IGNORE the error
                if (error.code === 11000) {
                    continue; 
                }
                throw error; // Real error? Throw it.
            }
        }
    }

    // --- FETCH FINAL SCHEDULE ---
    const sessions = await Attendance.find({
        date: todayDate,
        markedBy: teacher._id
    })
    .populate("course", "CourseName courseCode")
    .populate("section", "SectionName");

    const schedule = sessions.map(s => ({
        lecture_id: s._id,
        subject: s.course?.CourseName || "Unknown",
        courseCode: s.course?.courseCode || "",
        section_name: s.section?.SectionName || "",
        time: `${s.startTime} - ${s.endTime}`,
        room: s.roomNo,
        status: s.isLocked ? "Completed" : "Scheduled",
        type: s.isExtraClass ? "Temporary" : "Regular",
        totalStudents: s.students.length,
        presentCount: s.students.filter(st => st.status === "present").length
    })).sort((a, b) => a.time.localeCompare(b.time));

    res.status(200).json({ success: true, teacherName: teacher.name, schedule });
});


/* ============================================================
   4️⃣ STUDENT DASHBOARD (Read-Only)
============================================================ */
export const getStudentDashboard = asyncHandler(async (req, res) => {
    const user = req.user;
    const targetDate = req.query.date ? getNormalizedDate(req.query.date) : getNormalizedDate();
    const targetDayName = getDayName(targetDate);

    const student = await Student.findOne({ email: user.email });
    if (!student) return res.status(200).json({ success: true, schedule: [] });

    // Find Sections where student is enrolled & has class today
    const sections = await Section.find({
        "Student.Reg_No": student._id,
        "Day.Day": targetDayName
    })
    .populate("Course", "CourseName courseCode")
    .populate("Teacher", "name");

    // Fetch Attendance records for these sections
    const sectionIds = sections.map(sec => sec._id);
    const existingSessions = await Attendance.find({
        date: targetDate,
        section: { $in: sectionIds }
    }).populate("markedBy", "name");

    let schedule = [];

    sections.forEach((sec) => {
        const daySlots = sec.Day.filter(d => d.Day.includes(targetDayName));

        daySlots.forEach(slot => {
            // Match session by Section ID AND Start Time
            const activeSession = existingSessions.find(s => 
                s.section.toString() === sec._id.toString() && 
                s.startTime === slot.startTime // Exact string match "10:00" === "10:00"
            );

            let myStatus = "Pending";
            let teacherName = sec.Teacher?.name || "TBD";

            // If session exists (Teacher created it)
            if (activeSession) {
                teacherName = activeSession.markedBy?.name || teacherName; // Handle substitute
                const myRecord = activeSession.students.find(s => s.student.toString() === student._id.toString());
                if (myRecord) {
                    myStatus = myRecord.status.charAt(0).toUpperCase() + myRecord.status.slice(1);
                }
            } else if (targetDate < getNormalizedDate()) {
                // If past date and no session -> "No Class"
                myStatus = "No Record";
            }

            schedule.push({
                id: sec._id,
                subject: sec.Course?.CourseName || "Unknown",
                courseCode: sec.Course?.courseCode || "",
                teacher: teacherName,
                time: `${slot.startTime} - ${slot.endTime}`,
                room: sec.RoomNo,
                status: myStatus
            });
        });
    });

    schedule.sort((a, b) => a.time.localeCompare(b.time));

    res.status(200).json({
        success: true,
        role: "student",
        studentName: student.name,
        date: targetDate.toDateString(),
        day: targetDayName,
        count: schedule.length,
        schedule
    });
});