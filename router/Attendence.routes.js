import express from 'express';
import { upload } from '../MiddleWares/multer.js'; // Your multer file
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
} from '../controller/Attendence.Marked.js';

const attendance = express.Router();

// Create attendance session
attendance.post('/attendance/session', CreateAttendanceSession);

// Mark attendance with face recognition (single image)
// router.patch(
//     '/attendance/:attendanceId/face',
//     upload.single('image'),
//     MarkAttendanceWithFace
// );

// Bulk mark attendance with multiple faces
// router.patch(
//     '/attendance',
//     upload.array('images', 50),
//     BulkMarkAttendanceWithFaces
// );
 attendance.post('/upload',upload.array('images',5), (req,res)=>{
     res.json({message:"Files uploaded successfully",files:req.files});
    const files=req.files;
    console.log(files);
   

})

//attendance.route('/upload').post(upload.array('images',5),  MarkAttendanceWithFace);

// Manual bulk mark
attendance.patch('/attendance/:attendanceId/bulk', BulkMarkAttendance);

// Get attendance
attendance.get('/attendance/:attendanceId', GetAttendanceSession);
attendance.get('/attendance', GetAllAttendanceSessions);

// Student attendance history
attendance.get('/attendance/student/:studentId', GetStudentAttendance);

// Section reports
attendance.get('/attendance/section/:sectionId/report', GetSectionAttendanceReport);

// Lock attendance
attendance.patch('/attendance/:attendanceId/lock', LockAttendance);

// Delete
attendance.delete('/attendance/:attendanceId', DeleteAttendanceSession);

export default attendance;