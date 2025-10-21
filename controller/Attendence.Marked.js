import { Attendance } from "../modules/Attendance.js";
import { Section } from "../modules/Section.js";
import { Student } from "../modules/Student.js";
import { Course } from "../modules/Course.js";
import { asyncHandler } from "../asyncHandler.js";
//import { recognizeFace, detectFace } from "../services/faceRecognitionService.js";
import fs from 'fs';
import path from 'path';

// Create new attendance session
const CreateAttendanceSession = asyncHandler(async (req, res) => {
    const {
        sectionId,
        courseId,
        teacherId,
        date,
        startTime,
        endTime,
        day,
        roomNo,
        topic
    } = req.body;

    // Validate required fields
    if (!sectionId || !courseId || !teacherId || !date || !startTime || !endTime || !day) {
        return res.status(400).json({
            success: false,
            message: "Required fields: sectionId, courseId, teacherId, date, startTime, endTime, day"
        });
    }

    // Check if attendance already exists for this session
    const existing = await Attendance.findOne({
        section: sectionId,
        date: new Date(date),
        startTime,
        endTime
    });

    if (existing) {
        return res.status(409).json({
            success: false,
            message: "Attendance already marked for this session",
            data: existing
        });
    }

    // Get all students in the section
    const section = await Section.findById(sectionId).populate('Student.Reg_No');
    
    if (!section) {
        return res.status(404).json({
            success: false,
            message: "Section not found"
        });
    }

    // Initialize all students as absent
    const students = section.Student.map(s => ({
        student: s.Reg_No._id,
        status: 'absent',
        markedAt: new Date()
    }));

    // Create attendance record
    const attendance = await Attendance.create({
        section: sectionId,
        course: courseId,
        markedBy: teacherId,
        date: new Date(date),
        startTime,
        endTime,
        day,
        roomNo: roomNo || section.RoomNo,
        topic,
        students
    });

    const populated = await Attendance.findById(attendance._id)
        .populate('section', 'SectionName')
        .populate('course', 'courseCode CourseName')
        .populate('markedBy', 'name email')
        .populate('students.student', 'name regNo email');

    res.status(201).json({
        success: true,
        message: "Attendance session created successfully",
        data: populated
    });
});

// Mark attendance using face recognition
const MarkAttendanceWithFace = asyncHandler(async (req, res) => {
    const { attendanceId } = req.params;
    const { sectionId } = req.body;

    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: "No image file uploaded"
        });
    }

    const attendance = await Attendance.findById(attendanceId).populate('section');
    
    if (!attendance) {
        // Clean up uploaded file
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({
            success: false,
            message: "Attendance session not found"
        });
    }

    if (attendance.isLocked) {
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(403).json({
            success: false,
            message: "Attendance is locked and cannot be modified"
        });
    }

    try {
        // Step 1: Detect if face exists in image
        const detection = await detectFace(req.file.path);
        
        if (!detection.success || !detection.faceDetected) {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({
                success: false,
                message: "No clear face detected in image"
            });
        }

        // Step 2: Recognize face
        const recognition = await recognizeFace(req.file.path, { 
            sectionId: sectionId || attendance.section._id 
        });

        if (!recognition.success) {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({
                success: false,
                message: "Face not recognized",
                details: recognition.error
            });
        }

        // Step 3: Find student in attendance
        const studentIndex = attendance.students.findIndex(
            s => s.student.toString() === recognition.studentId
        );

        if (studentIndex === -1) {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(404).json({
                success: false,
                message: "Student not found in this section",
                recognizedStudent: recognition.studentId
            });
        }

        // Step 4: Move file to permanent location
        const newPath = path.join('./public/uploads/attendance', path.basename(req.file.path));
        if (req.file.path !== newPath) {
            fs.renameSync(req.file.path, newPath);
        }

        // Step 5: Mark attendance
        attendance.students[studentIndex].status = 'present';
        attendance.students[studentIndex].markedAt = new Date();
        attendance.students[studentIndex].faceRecognition = {
            imageUrl: `/uploads/attendance/${path.basename(newPath)}`,
            confidence: recognition.confidence,
            method: 'face-recognition',
            verified: recognition.confidence >= 80
        };

        await attendance.save();

        const updated = await Attendance.findById(attendanceId)
            .populate('section', 'SectionName')
            .populate('course', 'courseCode CourseName')
            .populate('students.student', 'name regNo email');

        res.status(200).json({
            success: true,
            message: "Attendance marked successfully using face recognition",
            data: {
                attendance: updated,
                recognition: {
                    studentId: recognition.studentId,
                    confidence: recognition.confidence,
                    verified: recognition.confidence >= 80,
                    imageUrl: `/uploads/attendance/${path.basename(newPath)}`
                }
            }
        });
    } catch (error) {
        // Clean up on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        throw error;
    }
});

// Bulk mark attendance with multiple face images
const BulkMarkAttendanceWithFaces = asyncHandler(async (req, res) => {
    const { attendanceId } = req.params;
    const { sectionId } = req.body;

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({
            success: false,
            message: "No image files uploaded"
        });
    }

    const attendance = await Attendance.findById(attendanceId);
    
    if (!attendance) {
        // Clean up uploaded files
        req.files.forEach(file => fs.unlinkSync(file.path));
        return res.status(404).json({
            success: false,
            message: "Attendance session not found"
        });
    }

    if (attendance.isLocked) {
        req.files.forEach(file => fs.unlinkSync(file.path));
        return res.status(403).json({
            success: false,
            message: "Attendance is locked and cannot be modified"
        });
    }

    const results = {
        successful: [],
        failed: []
    };

    // Process each image
    for (const file of req.files) {
        try {
            // Detect face
            const detection = await detectFace(file.path);
            
            if (!detection.success || !detection.faceDetected) {
                results.failed.push({
                    filename: file.originalname,
                    reason: "No face detected"
                });
                fs.unlinkSync(file.path);
                continue;
            }

            // Recognize face
            const recognition = await recognizeFace(file.path, { sectionId });

            if (!recognition.success) {
                results.failed.push({
                    filename: file.originalname,
                    reason: "Face not recognized"
                });
                fs.unlinkSync(file.path);
                continue;
            }

            // Find student in attendance
            const studentIndex = attendance.students.findIndex(
                s => s.student.toString() === recognition.studentId
            );

            if (studentIndex === -1) {
                results.failed.push({
                    filename: file.originalname,
                    reason: "Student not in section"
                });
                fs.unlinkSync(file.path);
                continue;
            }

            // Mark attendance
            attendance.students[studentIndex].status = 'present';
            attendance.students[studentIndex].markedAt = new Date();
            attendance.students[studentIndex].faceRecognition = {
                imageUrl: `/uploads/attendance/${path.basename(file.path)}`,
                confidence: recognition.confidence,
                method: 'face-recognition',
                verified: recognition.confidence >= 80
            };

            results.successful.push({
                filename: file.originalname,
                studentId: recognition.studentId,
                confidence: recognition.confidence
            });
        } catch (error) {
            results.failed.push({
                filename: file.originalname,
                reason: error.message
            });
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        }
    }

    await attendance.save();

    const updated = await Attendance.findById(attendanceId)
        .populate('students.student', 'name regNo email');

    res.status(200).json({
        success: true,
        message: `Processed ${req.files.length} images. ${results.successful.length} successful, ${results.failed.length} failed`,
        data: {
            attendance: updated,
            results
        }
    });
});

// Bulk mark attendance (mark all present/absent)
const BulkMarkAttendance = asyncHandler(async (req, res) => {
    const { attendanceId } = req.params;
    const { status, studentIds } = req.body;

    if (!status || !['present', 'absent', 'late', 'excused'].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Valid status required: present, absent, late, excused"
        });
    }

    const attendance = await Attendance.findById(attendanceId);
    
    if (!attendance) {
        return res.status(404).json({
            success: false,
            message: "Attendance session not found"
        });
    }

    if (attendance.isLocked) {
        return res.status(403).json({
            success: false,
            message: "Attendance is locked and cannot be modified"
        });
    }

    // If studentIds provided, mark only those students
    // Otherwise mark all students
    if (studentIds && Array.isArray(studentIds)) {
        attendance.students.forEach(student => {
            if (studentIds.includes(student.student.toString())) {
                student.status = status;
                student.markedAt = new Date();
            }
        });
    } else {
        attendance.students.forEach(student => {
            student.status = status;
            student.markedAt = new Date();
        });
    }

    await attendance.save();

    const updated = await Attendance.findById(attendanceId)
        .populate('students.student', 'name regNo email');

    res.status(200).json({
        success: true,
        message: `All students marked as ${status}`,
        data: updated
    });
});

// Get attendance for a specific session
const GetAttendanceSession = asyncHandler(async (req, res) => {
    const { attendanceId } = req.params;

    const attendance = await Attendance.findById(attendanceId)
        .populate('section', 'SectionName RoomNo')
        .populate('course', 'courseCode CourseName')
        .populate('markedBy', 'name email')
        .populate('students.student', 'name regNo email department Semester');

    if (!attendance) {
        return res.status(404).json({
            success: false,
            message: "Attendance session not found"
        });
    }

    res.status(200).json({
        success: true,
        data: attendance
    });
});

// Get all attendance sessions (with filters)
const GetAllAttendanceSessions = asyncHandler(async (req, res) => {
    const { 
        sectionId, 
        courseId, 
        date, 
        startDate, 
        endDate,
        page = 1,
        limit = 10 
    } = req.query;

    const filter = {};
    
    if (sectionId) filter.section = sectionId;
    if (courseId) filter.course = courseId;
    if (date) filter.date = new Date(date);
    if (startDate && endDate) {
        filter.date = {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
        };
    }

    const attendance = await Attendance.find(filter)
        .populate('section', 'SectionName')
        .populate('course', 'courseCode CourseName')
        .populate('markedBy', 'name email')
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit))
        .sort({ date: -1, startTime: -1 });

    const total = await Attendance.countDocuments(filter);

    res.status(200).json({
        success: true,
        data: attendance,
        pagination: {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / parseInt(limit))
        }
    });
});

// Get student's attendance history
const GetStudentAttendance = asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { courseId, sectionId, startDate, endDate } = req.query;

    const filter = {
        'students.student': studentId
    };

    if (courseId) filter.course = courseId;
    if (sectionId) filter.section = sectionId;
    if (startDate && endDate) {
        filter.date = {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
        };
    }

    const attendance = await Attendance.find(filter)
        .populate('section', 'SectionName')
        .populate('course', 'courseCode CourseName')
        .sort({ date: -1 });

    // Extract this student's attendance from each session
    const studentAttendance = attendance.map(session => {
        const studentRecord = session.students.find(
            s => s.student.toString() === studentId
        );
        
        return {
            date: session.date,
            day: session.day,
            startTime: session.startTime,
            endTime: session.endTime,
            course: session.course,
            section: session.section,
            status: studentRecord?.status,
            remarks: studentRecord?.remarks,
            topic: session.topic
        };
    });

    // Calculate statistics
    const totalClasses = studentAttendance.length;
    const present = studentAttendance.filter(a => a.status === 'present' || a.status === 'late').length;
    const absent = studentAttendance.filter(a => a.status === 'absent').length;
    const attendancePercentage = totalClasses > 0 ? Math.round((present / totalClasses) * 100) : 0;

    res.status(200).json({
        success: true,
        data: {
            studentId,
            attendance: studentAttendance,
            statistics: {
                totalClasses,
                present,
                absent,
                attendancePercentage
            }
        }
    });
});

// Get attendance report for a section
const GetSectionAttendanceReport = asyncHandler(async (req, res) => {
    const { sectionId } = req.params;
    const { startDate, endDate } = req.query;

    const filter = {
        section: sectionId
    };

    if (startDate && endDate) {
        filter.date = {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
        };
    }

    const sessions = await Attendance.find(filter)
        .populate('students.student', 'name regNo email')
        .sort({ date: 1 });

    if (sessions.length === 0) {
        return res.status(404).json({
            success: false,
            message: "No attendance records found for this section"
        });
    }

    // Calculate per-student statistics
    const studentStats = new Map();

    sessions.forEach(session => {
        session.students.forEach(student => {
            const studentId = student.student._id.toString();
            
            if (!studentStats.has(studentId)) {
                studentStats.set(studentId, {
                    student: student.student,
                    totalClasses: 0,
                    present: 0,
                    absent: 0,
                    late: 0,
                    excused: 0
                });
            }

            const stats = studentStats.get(studentId);
            stats.totalClasses++;
            
            if (student.status === 'present') stats.present++;
            else if (student.status === 'absent') stats.absent++;
            else if (student.status === 'late') stats.late++;
            else if (student.status === 'excused') stats.excused++;
        });
    });

    // Convert to array and add percentage
    const report = Array.from(studentStats.values()).map(stat => ({
        ...stat,
        attendancePercentage: Math.round(((stat.present + stat.late) / stat.totalClasses) * 100)
    }));

    // Sort by attendance percentage
    report.sort((a, b) => b.attendancePercentage - a.attendancePercentage);

    res.status(200).json({
        success: true,
        data: {
            sectionId,
            totalSessions: sessions.length,
            dateRange: {
                from: startDate || sessions[0]?.date,
                to: endDate || sessions[sessions.length - 1]?.date
            },
            studentReport: report
        }
    });
});

// Lock attendance (prevent further changes)
const LockAttendance = asyncHandler(async (req, res) => {
    const { attendanceId } = req.params;

    const attendance = await Attendance.findByIdAndUpdate(
        attendanceId,
        { isLocked: true },
        { new: true }
    );

    if (!attendance) {
        return res.status(404).json({
            success: false,
            message: "Attendance session not found"
        });
    }

    res.status(200).json({
        success: true,
        message: "Attendance locked successfully",
        data: attendance
    });
});

// Delete attendance session
const DeleteAttendanceSession = asyncHandler(async (req, res) => {
    const { attendanceId } = req.params;

    const attendance = await Attendance.findById(attendanceId);

    if (!attendance) {
        return res.status(404).json({
            success: false,
            message: "Attendance session not found"
        });
    }

    if (attendance.isLocked) {
        return res.status(403).json({
            success: false,
            message: "Cannot delete locked attendance"
        });
    }

    await Attendance.findByIdAndDelete(attendanceId);

    res.status(200).json({
        success: true,
        message: "Attendance session deleted successfully"
    });
});

export {
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
};