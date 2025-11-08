import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { asyncHandler } from '../asyncHandler.js';
import { detectFace, recognizeFace, generateAttendanceReport } from '../Services/faceRecognition.js';
import { Attendance } from '../modules/Attendance.js';
import { Section } from '../modules/Section.js';
import { Student } from '../modules/Student.js';
import { Course } from '../modules/Course.js';

// Setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, '../../public/uploads/attendance');

// Config
const FILE_CLEANUP_DELAY_HOURS = 12;
const CONFIDENCE_THRESHOLD = parseFloat(process.env.FACE_RECOGNITION_CONFIDENCE_THRESHOLD) || 80;

// Ensure uploads dir exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Cleanup helper
const deleteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error(`Failed to delete file ${filePath}:`, err.message);
  }
};

// Normalize date
const normalizeDate = (dateString) => {
  const d = new Date(dateString);
  d.setHours(0, 0, 0, 0);
  return d;
};

//
// ────────────────────────────────────────────────────────────────
//   MARK ATTENDANCE USING FACE (SINGLE OR GROUP)
// ────────────────────────────────────────────────────────────────
//
export const MarkAttendanceWithFace = asyncHandler(async (req, res) => {
  const { attendanceId } = req.params;
  const files = req.files || [];

  if (!files.length) {
    return res.status(400).json({ success: false, message: "No images uploaded" });
  }

  // 🧩 Get attendance and section directly
  const attendance = await Attendance.findById(attendanceId)
    .populate("section")
    .populate("students.student", "name regNo email");

  if (!attendance) {
    files.forEach(f => fs.unlinkSync(f.path));
    return res.status(404).json({ success: false, message: "Attendance session not found" });
  }

  if (attendance.isLocked) {
    files.forEach(f => fs.unlinkSync(f.path));
    return res.status(403).json({ success: false, message: "Attendance is locked" });
  }

  // ✅ Now we can directly access sectionId from attendance
  const sectionId = attendance.section._id.toString();

  let totalRecognized = 0;
  const recognizedStudents = new Set();

  for (const file of files) {
    const detection = await detectFace(file.path);
    if (!detection.success || !detection.faceDetected) continue;

    // Pass the sectionId we just derived from DB
    const recognition = await recognizeFace(file.path, { sectionId });
    if (!recognition.success) continue;

    for (const match of recognition.matches) {
      const studentIndex = attendance.students.findIndex(
        s => s.student.name === match.studentId || s.student.regNo === match.studentId
      );

      if (studentIndex !== -1) {
        const studentEntry = attendance.students[studentIndex];
        if (studentEntry.status !== "present") {
          studentEntry.status = "present";
          studentEntry.markedAt = new Date();
          studentEntry.faceRecognition = {
            confidence: match.confidence,
            method: "face-recognition",
            verified: match.confidence * 100 >= CONFIDENCE_THRESHOLD
          };
          totalRecognized++;
          recognizedStudents.add(match.studentId);
        }
      }
    }

    const newPath = path.join(UPLOAD_DIR, `${attendance._id}_${Date.now()}_${file.originalname}`);
    fs.renameSync(file.path, newPath);
  }

  await attendance.save();

  const updated = await Attendance.findById(attendanceId)
    .populate("students.student", "name regNo email");

  res.status(200).json({
    success: true,
    message: `Marked ${recognizedStudents.size} students present using ${files.length} image(s).`,
    data: {
      attendance: updated,
      recognizedStudents: [...recognizedStudents]
    }
  });
});

//
// ────────────────────────────────────────────────────────────────
//   CREATE NEW ATTENDANCE SESSION
// ────────────────────────────────────────────────────────────────
//
 export const CreateAttendanceSession = asyncHandler(async (req, res) => {
  const { sectionId, courseId, teacherId, date, startTime, endTime, day, topic,roomNo  } = req.body;

  if (!sectionId || !courseId || !teacherId || !date || !startTime || !endTime) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields: sectionId, courseId, teacherId, date, startTime, endTime'
    });
  }
  const normalizedDate = normalizeDate(date);

  // Avoid duplicate session
  const existing = await Attendance.findOne({
    section: sectionId,
    date: normalizedDate,
    startTime,
    endTime
  });

  if (existing) {
    return res.status(409).json({ success: false, message: 'Attendance already exists for this session.' });
  }

  // Get section students
  const section = await Section.findById(sectionId).populate({
    path: 'Student.Reg_No',
    select: 'name regNo email'
  });

  if (!section) return res.status(404).json({ success: false, message: 'Section not found.' });
  const finalRoomNo = roomNo || section.RoomNo || 'TBD';

  const students = (section.Student || []).map((s) => ({
    student: s.Reg_No,
    status: 'absent'
  }));

  const attendance = await Attendance.create({
    section: sectionId,
    course: courseId,
    markedBy: teacherId,
    date: normalizedDate,
    startTime,
    endTime,
    day,
    topic,
    students,
    isLocked: false
  });

  const populated = await Attendance.findById(attendance._id)
    .populate('section', 'SectionName RoomNo')
    .populate('course', 'CourseName courseCode')
    .populate('markedBy', 'name email')
    .populate('students.student', 'name regNo email');

  res.status(201).json({
    success: true,
    message: 'Attendance session created successfully.',
    data: populated
  });
});

//
// ────────────────────────────────────────────────────────────────
//    REPORT USING HF REPORT API
// ────────────────────────────────────────────────────────────────
//
 export const AttendanceReport = asyncHandler(async (req, res) => {
  const { sectionId } = req.params;

  const sessions = await Attendance.find({ section: sectionId })
    .populate('students.student', 'name regNo email')
    .populate('course', 'courseName courseCode')
    .populate('section', 'SectionName')
    .sort({ date: 1 });

  if (!sessions.length) {
    return res.status(404).json({ success: false, message: 'No attendance records found.' });
  }

  // Convert sessions into recognition-like format for report API
  const recognitionResults = [];
  sessions.forEach((session) => {
    session.students.forEach((s) => {
      recognitionResults.push({
        name: s.student.name,
        confidence: s.faceRecognition?.confidence || 1,
        matched: s.status === 'present'
      });
    });
  });

  const report = await generateAttendanceReport({ results: recognitionResults });

  if (!report.success) {
    return res.status(500).json({ success: false, message: 'Report generation failed.', error: report.error });
  }

  res.setHeader(
    'Content-Disposition',
    `attachment; filename=attendance_report_${sectionId}_${Date.now()}.xlsx`
  );
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );

  res.status(200).send(report.reportData);
});
{
    MarkAttendanceWithFace,
    CreateAttendanceSession,
    AttendanceReport
}
