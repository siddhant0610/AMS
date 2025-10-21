import express from 'express';
import { uploadAttendance } from '../multer.middleware.js'; // Your multer file
import {
    CreateAttendanceSession,
    MarkAttendanceWithFace,
    BulkMarkAttendanceWithFaces,
    BulkMarkAttendance,
    GetAttendanceSession,
    GetAllAttendanceSessions,
    GetStudentAttendance,
    GetSectionAttendanceReport,
    LockAttendance,
    DeleteAttendanceSession
} from '../controller/Attendance.Marked.js';

const router = express.Router();

// Create attendance session
router.post('/attendance/session', CreateAttendanceSession);

// Mark attendance with face recognition (single image)
router.patch(
    '/attendance/:attendanceId/face',
    uploadAttendance.single('image'),
    MarkAttendanceWithFace
);

// Bulk mark attendance with multiple faces
router.patch(
    '/attendance/:attendanceId/faces',
    uploadAttendance.array('images', 50),
    BulkMarkAttendanceWithFaces
);

// Manual bulk mark
router.patch('/attendance/:attendanceId/bulk', BulkMarkAttendance);

// Get attendance
router.get('/attendance/:attendanceId', GetAttendanceSession);
router.get('/attendance', GetAllAttendanceSessions);

// Student attendance history
router.get('/attendance/student/:studentId', GetStudentAttendance);

// Section reports
router.get('/attendance/section/:sectionId/report', GetSectionAttendanceReport);

// Lock attendance
router.patch('/attendance/:attendanceId/lock', LockAttendance);

// Delete
router.delete('/attendance/:attendanceId', DeleteAttendanceSession);

export default router;