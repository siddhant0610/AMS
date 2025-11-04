import { Attendance } from "../modules/Attendance.js";
import { Section } from "../modules/Section.js";
import { Student } from "../modules/Student.js";
import { Course } from "../modules/Course.js";
import { asyncHandler } from "../asyncHandler.js";
import { recognizeFace, detectFace } from "../services/faceRecognitionService.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const UPLOAD_DIR = path.join(__dirname, '../../public/uploads/attendance');
const CONFIDENCE_THRESHOLD = parseFloat(process.env.FACE_RECOGNITION_CONFIDENCE_THRESHOLD) || 80;
const FILE_CLEANUP_DELAY_HOURS = 24;

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
// Utility: File cleanup with delay
const scheduleFileCleanup = (filePath, delayHours = FILE_CLEANUP_DELAY_HOURS) => {
    setTimeout(() => {
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log(`Cleaned up file: ${filePath}`);
            } catch (error) {
                console.error(`Failed to cleanup file ${filePath}:`, error.message);
            }
        }
    }, delayHours * 60 * 60 * 1000);
};

// Utility: Delete file immediately
const deleteFile = (filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
        } catch (error) {
            console.error(`Failed to delete file ${filePath}:`, error.message);
        }
    }
};

// Utility: Delete multiple files
const deleteFiles = (files) => {
    if (Array.isArray(files)) {
        files.forEach(file => deleteFile(file.path || file));
    }
};

// Utility: Normalize date to start of day
const normalizeDate = (dateString) => {
    const date = new Date(dateString);
    date.setHours(0, 0, 0, 0);
    return date;
};

// Utility: Retry API calls with exponential backoff
const retryWithBackoff = async (fn, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            const delay = Math.pow(2, i) * 1000;
            console.log(`Retry attempt ${i + 1} after ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};
/**
 * Create new attendance session
 * POST /api/attendance/create
 */
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

    // Validate time format (HH:MM)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
        return res.status(400).json({
            success: false,
            message: "Invalid time format. Use HH:MM format"
        });
    }

    // Normalize date
    const normalizedDate = normalizeDate(date);

    // Check if attendance already exists for this session
    const existing = await Attendance.findOne({
        section: sectionId,
        date: normalizedDate,
        startTime,
        endTime
    });

    if (existing) {
        return res.status(409).json({
            success: false,
            message: "Attendance already exists for this session",
            data: existing
        });
    }

    // Get section with students
    const section = await Section.findById(sectionId).populate('Student');

    if (!section) {
        return res.status(404).json({
            success: false,
            message: "Section not found"
        });
    }

    if (!section.students || section.students.length === 0) {
        return res.status(400).json({
            success: false,
            message: "No students found in this section"
        });
    }

    // Verify course exists
    const course = await Course.findById(courseId);
    if (!course) {
        return res.status(404).json({
            success: false,
            message: "Course not found"
        });
    }

    // Initialize all students as absent
    const students = section.students.map(student => ({
        student: student._id,
        status: 'absent',
        markedAt: new Date()
    }));

    // Create attendance record
    const attendance = await Attendance.create({
        section: sectionId,
        course: courseId,
        markedBy: teacherId,
        date: normalizedDate,
        startTime,
        endTime,
        day,
        roomNo: roomNo || section.roomNo,
        topic,
        students,
        isLocked: false
    });

    // Populate and return
    const populated = await Attendance.findById(attendance._id)
        .populate('section', 'sectionName roomNo')
        .populate('course', 'courseCode courseName')
        .populate('markedBy', 'name email')
        .populate('students.student', 'name regNo email');

    res.status(201).json({
        success: true,
        message: "Attendance session created successfully",
        data: populated
    });
});
/**
 * Mark attendance using face recognition (single image)
 * POST /api/attendance/mark-face/:attendanceId
 */
const MarkAttendanceWithFace = asyncHandler(async (req, res) => {
    const { attendanceId } = req.params;
    const { sectionId } = req.body;

    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: "No image file uploaded"
        });
    }

    try {
        // Get attendance record
        const attendance = await Attendance.findById(attendanceId)
            .populate('section')
            .populate('students.student', 'name regNo email');

        if (!attendance) {
            deleteFile(req.file.path);
            return res.status(404).json({
                success: false,
                message: "Attendance session not found"
            });
        }

        if (attendance.isLocked) {
            deleteFile(req.file.path);
            return res.status(403).json({
                success: false,
                message: "Attendance is locked and cannot be modified"
            });
        }

        // Step 1: Detect face in image
        console.log('Detecting face in image...');
        const detection = await retryWithBackoff(() => detectFace(req.file.path));

        if (!detection.success || !detection.faceDetected) {
            deleteFile(req.file.path);
            return res.status(400).json({
                success: false,
                message: "No clear face detected in image. Please ensure proper lighting and face visibility."
            });
        }

        // Step 2: Recognize face
        console.log('Recognizing face...');
        const recognition = await retryWithBackoff(() =>
            recognizeFace(req.file.path, {
                sectionId: SectionName || attendance.section._id.toString()
            })
        );

        if (!recognition.success) {
            deleteFile(req.file.path);
            return res.status(400).json({
                success: false,
                message: "Face not recognized. Please try again or contact administrator.",
                details: recognition.error
            });
        }

        // Step 3: Find student in attendance
        const studentIndex = attendance.students.findIndex(
            s => s.student._id.toString() === recognition.studentId.toString()
        );

        if (studentIndex === -1) {
            deleteFile(req.file.path);
            return res.status(404).json({
                success: false,
                message: "Student not found in this section",
                recognizedStudent: recognition.studentId
            });
        }

        // Check if already marked present
        if (attendance.students[studentIndex].status === 'present') {
            deleteFile(req.file.path);
            return res.status(400).json({
                success: false,
                message: "Attendance already marked for this student",
                student: attendance.students[studentIndex].student
            });
        }

        // Step 4: Move file to permanent location with unique name
        const timestamp = Date.now();
        const fileName = `${attendance._id}_${recognition.studentId}_${timestamp}${path.extname(req.file.path)}`;
        const newPath = path.join(UPLOAD_DIR, fileName);

        fs.renameSync(req.file.path, newPath);
        scheduleFileCleanup(newPath, FILE_CLEANUP_DELAY_HOURS);

        // Step 5: Mark attendance
        attendance.students[studentIndex].status = 'present';
        attendance.students[studentIndex].markedAt = new Date();
        attendance.students[studentIndex].faceRecognition = {
            imageUrl: `/uploads/attendance/${fileName}`,
            confidence: recognition.confidence,
            method: 'face-recognition',
            verified: recognition.confidence >= CONFIDENCE_THRESHOLD
        };

        await attendance.save();

        // Return updated attendance
        const updated = await Attendance.findById(attendanceId)
            .populate('section', 'sectionName')
            .populate('course', 'courseCode courseName')
            .populate('students.student', 'name regNo email');

        res.status(200).json({
            success: true,
            message: "Attendance marked successfully using face recognition",
            data: {
                attendance: updated,
                recognition: {
                    studentId: recognition.studentId,
                    studentName: attendance.students[studentIndex].student.name,
                    regNo: attendance.students[studentIndex].student.regNo,
                    confidence: recognition.confidence,
                    verified: recognition.confidence >= CONFIDENCE_THRESHOLD,
                    imageUrl: `/uploads/attendance/${fileName}`
                }
            }
        });
    } catch (error) {
        deleteFile(req.file?.path);
        console.error('Face recognition error:', error);
        throw error;
    }
});
/**
 * Bulk mark attendance with multiple face images
 * POST /api/attendance/bulk-mark-faces/:attendanceId
 */
const BulkMarkAttendanceWithFaces = asyncHandler(async (req, res) => {
    const { attendanceId } = req.params;
    const { sectionId } = req.body;

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({
            success: false,
            message: "No image files uploaded"
        });
    }

    const attendance = await Attendance.findById(attendanceId)
        .populate('students.student', 'name regNo email');

    if (!attendance) {
        deleteFiles(req.files);
        return res.status(404).json({
            success: false,
            message: "Attendance session not found"
        });
    }

    if (attendance.isLocked) {
        deleteFiles(req.files);
        return res.status(403).json({
            success: false,
            message: "Attendance is locked and cannot be modified"
        });
    }

    const results = {
        successful: [],
        failed: [],
        duplicate: []
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
                deleteFile(file.path);
                continue;
            }

            // Recognize face
            const recognition = await recognizeFace(file.path, {
                sectionId: sectionId || attendance.section.toString()
            });

            if (!recognition.success) {
                results.failed.push({
                    filename: file.originalname,
                    reason: "Face not recognized"
                });
                deleteFile(file.path);
                continue;
            }

            // Find student in attendance
            const studentIndex = attendance.students.findIndex(
                s => s.student._id.toString() === recognition.studentId.toString()
            );

            if (studentIndex === -1) {
                results.failed.push({
                    filename: file.originalname,
                    reason: "Student not in section",
                    studentId: recognition.studentId
                });
                deleteFile(file.path);
                continue;
            }

            // Check if already marked
            if (attendance.students[studentIndex].status === 'present') {
                results.duplicate.push({
                    filename: file.originalname,
                    studentId: recognition.studentId,
                    studentName: attendance.students[studentIndex].student.name
                });
                deleteFile(file.path);
                continue;
            }

            // Move file to permanent location
            const timestamp = Date.now();
            const fileName = `${attendance._id}_${recognition.studentId}_${timestamp}${path.extname(file.path)}`;
            const newPath = path.join(UPLOAD_DIR, fileName);

            fs.renameSync(file.path, newPath);
            scheduleFileCleanup(newPath, FILE_CLEANUP_DELAY_HOURS);

            // Mark attendance
            attendance.students[studentIndex].status = 'present';
            attendance.students[studentIndex].markedAt = new Date();
            attendance.students[studentIndex].faceRecognition = {
                imageUrl: `/uploads/attendance/${fileName}`,
                confidence: recognition.confidence,
                method: 'face-recognition',
                verified: recognition.confidence >= CONFIDENCE_THRESHOLD
            };

            results.successful.push({
                filename: file.originalname,
                studentId: recognition.studentId,
                studentName: attendance.students[studentIndex].student.name,
                regNo: attendance.students[studentIndex].student.regNo,
                confidence: recognition.confidence
            });
        } catch (error) {
            results.failed.push({
                filename: file.originalname,
                reason: error.message
            });
            deleteFile(file.path);
        }
    }

    await attendance.save();

    const updated = await Attendance.findById(attendanceId)
        .populate('students.student', 'name regNo email');

    res.status(200).json({
        success: true,
        message: `Processed ${req.files.length} images. ${results.successful.length} successful, ${results.failed.length} failed, ${results.duplicate.length} duplicates`,
        data: {
            attendance: updated,
            results
        }
    });
});
/**
 * Manual bulk mark attendance (mark all or selected students)
 * POST /api/attendance/bulk-mark/:attendanceId
 */
const BulkMarkAttendance = asyncHandler(async (req, res) => {
    const { attendanceId } = req.params;
    const { status, studentIds, remarks } = req.body;

    if (!status || !['present', 'absent', 'not-considered'].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Valid status required: present,absent,not-considered "
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

    let markedCount = 0;

    // If studentIds provided, mark only those students
    if (studentIds && Array.isArray(studentIds) && studentIds.length > 0) {
        attendance.students.forEach(student => {
            if (studentIds.includes(student.student.toString())) {
                student.status = status;
                student.markedAt = new Date();
                if (remarks) student.remarks = remarks;
                markedCount++;
            }
        });
    } else {
        // Mark all students
        attendance.students.forEach(student => {
            student.status = status;
            student.markedAt = new Date();
            if (remarks) student.remarks = remarks;
            markedCount++;
        });
    }

    await attendance.save();

    const updated = await Attendance.findById(attendanceId)
        .populate('students.student', 'name regNo email');

    res.status(200).json({
        success: true,
        message: `${markedCount} students marked as ${status}`,
        data: updated
    });
});
/**
 * Get attendance for a specific session
 * GET /api/attendance/:attendanceId
 */
const GetAttendanceSession = asyncHandler(async (req, res) => {
    const { attendanceId } = req.params;

    const attendance = await Attendance.findById(attendanceId)
        .populate('section', 'sectionName roomNo')
        .populate('course', 'courseCode courseName')
        .populate('markedBy', 'name email')
        .populate('students.student', 'name regNo email department semester');

    if (!attendance) {
        return res.status(404).json({
            success: false,
            message: "Attendance session not found"
        });
    }

    // Calculate statistics
    const totalStudents = attendance.students.length;
    const present = attendance.students.filter(s => s.status === 'present').length;
    const absent = attendance.students.filter(s => s.status === 'absent').length;
    const late = attendance.students.filter(s => s.status === 'late').length;
    const excused = attendance.students.filter(s => s.status === 'excused').length;
    const attendancePercentage = totalStudents > 0
        ? Math.round(((present + late) / totalStudents) * 100)
        : 0;

    res.status(200).json({
        success: true,
        data: {
            ...attendance.toObject(),
            statistics: {
                totalStudents,
                present,
                absent,
                late,
                excused,
                attendancePercentage
            }
        }
    });
});
/**
 * Get all attendance sessions (with filters)
 * GET /api/attendance
 */
const GetAllAttendanceSessions = asyncHandler(async (req, res) => {
    const {
        sectionId,
        courseId,
        teacherId,
        date,
        startDate,
        endDate,
        status,
        page = 1,
        limit = 10,
        sortBy = 'date',
        sortOrder = 'desc'
    } = req.query;

    const filter = {};

    if (sectionId) filter.section = sectionId;
    if (courseId) filter.course = courseId;
    if (teacherId) filter.markedBy = teacherId;
    if (status) filter.isLocked = status === 'locked';

    if (date) {
        filter.date = normalizeDate(date);
    } else if (startDate && endDate) {
        filter.date = {
            $gte: normalizeDate(startDate),
            $lte: normalizeDate(endDate)
        };
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const attendance = await Attendance.find(filter)
        .populate('section', 'sectionName')
        .populate('course', 'courseCode courseName')
        .populate('markedBy', 'name email')
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit))
        .sort(sortOptions);

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
/**
 * Get student's attendance history
 * GET /api/attendance/student/:regNo
 */
const GetStudentAttendance = asyncHandler(async (req, res) => {
    const { regNo } = req.params;
    const { courseId, sectionId, startDate, endDate } = req.query;

    // Find student
    const student = await Student.findOne({ regNo });
    if (!student) {
        return res.status(404).json({
            success: false,
            message: "Student not found"
        });
    }

    const filter = {
        'students.student': student._id
    };

    if (courseId) filter.course = courseId;
    if (sectionId) filter.section = sectionId;

    if (startDate && endDate) {
        filter.date = {
            $gte: normalizeDate(startDate),
            $lte: normalizeDate(endDate)
        };
    }

    const attendance = await Attendance.find(filter)
        .populate('section', 'sectionName')
        .populate('course', 'courseCode courseName')
        .populate('markedBy', 'name')
        .sort({ date: -1 });

    // Extract this student's attendance from each session
    const studentAttendance = attendance.map(session => {
        const studentRecord = session.students.find(
            s => s.student.toString() === student._id.toString()
        );

        return {
            attendanceId: session._id,
            date: session.date,
            day: session.day,
            startTime: session.startTime,
            endTime: session.endTime,
            course: session.course,
            section: session.section,
            markedBy: session.markedBy,
            status: studentRecord?.status,
            markedAt: studentRecord?.markedAt,
            remarks: studentRecord?.remarks,
            topic: session.topic,
            faceRecognition: studentRecord?.faceRecognition
        };
    });

    // Calculate statistics
    const totalClasses = studentAttendance.length;
    const present = studentAttendance.filter(a =>
        a.status === 'present' || a.status === 'late'
    ).length;
    const absent = studentAttendance.filter(a => a.status === 'absent').length;
    const excused = studentAttendance.filter(a => a.status === 'excused').length;
    const attendancePercentage = totalClasses > 0
        ? Math.round((present / totalClasses) * 100)
        : 0;

    res.status(200).json({
        success: true,
        data: {
            student: {
                _id: student._id,
                name: student.name,
                regNo: student.regNo,
                email: student.email
            },
            attendance: studentAttendance,
            statistics: {
                totalClasses,
                present,
                absent,
                excused,
                attendancePercentage
            }
        }
    });
});
/**
 * Get attendance report for a section
 * GET /api/attendance/report/section/:sectionId
 */
const GetSectionAttendanceReport = asyncHandler(async (req, res) => {
    const { sectionId } = req.params;
    const { courseId, startDate, endDate } = req.query;

    const filter = { section: sectionId };

    if (courseId) filter.course = courseId;

    if (startDate && endDate) {
        filter.date = {
            $gte: normalizeDate(startDate),
            $lte: normalizeDate(endDate)
        };
    }

    const sessions = await Attendance.find(filter)
        .populate('students.student', 'name regNo email')
        .populate('course', 'courseCode courseName')
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
        student: stat.student,
        totalClasses: stat.totalClasses,
        present: stat.present,
        absent: stat.absent,
        late: stat.late,
        excused: stat.excused,
        attendancePercentage: Math.round(
            ((stat.present + stat.late) / stat.totalClasses) * 100
        )
    }));

    // Sort by attendance percentage (lowest first for intervention)
    report.sort((a, b) => a.attendancePercentage - b.attendancePercentage);

    // Calculate section statistics
    const totalSessions = sessions.length;
    const avgAttendance = report.length > 0
        ? Math.round(
            report.reduce((sum, s) => sum + s.attendancePercentage, 0) / report.length
        )
        : 0;
    const studentsBelow75 = report.filter(s => s.attendancePercentage < 75).length;

    res.status(200).json({
        success: true,
        data: {
            sectionId,
            totalSessions,
            dateRange: {
                from: sessions[0]?.date,
                to: sessions[sessions.length - 1]?.date
            },
            sectionStatistics: {
                totalStudents: report.length,
                averageAttendance: avgAttendance,
                studentsBelow75Percent: studentsBelow75
            },
            studentReport: report
        }
    });
});
/**
 * Lock attendance (prevent further changes)
 * PUT /api/attendance/lock/:attendanceId
 */
const LockAttendance = asyncHandler(async (req, res) => {
    const { attendanceId } = req.params;

    const attendance = await Attendance.findByIdAndUpdate(
        attendanceId,
        { isLocked: true, lockedAt: new Date() },
        { new: true }
    )
        .populate('section', 'sectionName')
        .populate('course', 'courseCode courseName');

    if (!attendance) {
        return res.status(404).json({
            success: false,
            message: "Attendance session not found"
        });
    }

    res.status(200).json({
        success: true,
        message: "Attendance locked successfully. No further modifications allowed.",
        data: attendance
    });
});

/**
 * Unlock attendance (allow modifications)
 * PUT /api/attendance/unlock/:attendanceId
 */
const UnlockAttendance = asyncHandler(async (req, res) => {
    const { attendanceId } = req.params;

    const attendance = await Attendance.findByIdAndUpdate(
        attendanceId,
        { isLocked: false, lockedAt: null },
        { new: true }
    )
        .populate('section', 'sectionName')
        .populate('course', 'courseCode courseName');

    if (!attendance) {
        return res.status(404).json({
            success: false,
            message: "Attendance session not found"
        });
    }

    res.status(200).json({
        success: true,
        message: "Attendance unlocked successfully",
        data: attendance
    });
});

/**
 * Update individual student attendance status
 * PUT /api/attendance/:attendanceId/student/:studentId
 */
const UpdateStudentAttendance = asyncHandler(async (req, res) => {
    const { attendanceId, studentId } = req.params;
    const { status, remarks } = req.body;

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

    const studentIndex = attendance.students.findIndex(
        s => s.student.toString() === studentId
    );

    if (studentIndex === -1) {
        return res.status(404).json({
            success: false,
            message: "Student not found in this attendance session"
        });
    }

    attendance.students[studentIndex].status = status;
    attendance.students[studentIndex].markedAt = new Date();
    if (remarks) attendance.students[studentIndex].remarks = remarks;

    await attendance.save();

    const updated = await Attendance.findById(attendanceId)
        .populate('students.student', 'name regNo email');

    res.status(200).json({
        success: true,
        message: "Student attendance updated successfully",
        data: updated
    });
});
/**
 * Delete attendance session
 * DELETE /api/attendance/:attendanceId
 */
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
            message: "Cannot delete locked attendance. Please unlock it first."
        });
    }

    // Delete associated face recognition images
    attendance.students.forEach(student => {
        if (student.faceRecognition?.imageUrl) {
            const imagePath = path.join(__dirname, '../../public', student.faceRecognition.imageUrl);
            deleteFile(imagePath);
        }
    });

    await Attendance.findByIdAndDelete(attendanceId);

    res.status(200).json({
        success: true,
        message: "Attendance session deleted successfully"
    });
});
/**
 * Get attendance statistics for dashboard
 * GET /api/attendance/statistics
 */
const GetAttendanceStatistics = asyncHandler(async (req, res) => {
    const { sectionId, courseId, startDate, endDate } = req.query;

    const filter = {};

    if (sectionId) filter.section = sectionId;
    if (courseId) filter.course = courseId;

    if (startDate && endDate) {
        filter.date = {
            $gte: normalizeDate(startDate),
            $lte: normalizeDate(endDate)
        };
    }

    const sessions = await Attendance.find(filter);

    let totalClasses = 0;
    let totalPresent = 0;
    let totalAbsent = 0;
    let totalLate = 0;
    let totalStudents = 0;

    sessions.forEach(session => {
        totalClasses++;
        session.students.forEach(student => {
            totalStudents++;
            if (student.status === 'present') totalPresent++;
            else if (student.status === 'absent') totalAbsent++;
            else if (student.status === 'late') totalLate++;
        });
    });

    const avgAttendanceRate = totalStudents > 0
        ? Math.round(((totalPresent + totalLate) / totalStudents) * 100)
        : 0;

    res.status(200).json({
        success: true,
        data: {
            totalClasses,
            totalPresent,
            totalAbsent,
            totalLate,
            averageAttendanceRate: avgAttendanceRate,
            dateRange: {
                from: startDate,
                to: endDate
            }
        }
    });
});
/**
 * Export attendance report using Hugging Face Report Generation API
 * GET /api/attendance/export/:sectionId
 */
const ExportAttendanceReport = asyncHandler(async (req, res) => {
    const { sectionId } = req.params;
    const { courseId, startDate, endDate, format = 'excel' } = req.query;

    const filter = { section: sectionId };

    if (courseId) filter.course = courseId;

    if (startDate && endDate) {
        filter.date = {
            $gte: normalizeDate(startDate),
            $lte: normalizeDate(endDate)
        };
    }

    const sessions = await Attendance.find(filter)
        .populate('students.student', 'name regNo email')
        .populate('course', 'courseCode courseName')
        .populate('section', 'sectionName')
        .sort({ date: 1 });

    if (sessions.length === 0) {
        return res.status(404).json({
            success: false,
            message: "No attendance records found"
        });
    }

    // Handle different formats
    if (format === 'csv') {
        // Build CSV
        let csv = 'RegNo,Name,Email';

        // Add date headers
        sessions.forEach(session => {
            const dateStr = session.date.toISOString().split('T')[0];
            csv += `,${dateStr}`;
        });
        csv += ',Total Present,Total Absent,Attendance %\n';

        // Collect all unique students
        const studentMap = new Map();

        sessions.forEach(session => {
            session.students.forEach(student => {
                const sid = student.student._id.toString();
                if (!studentMap.has(sid)) {
                    studentMap.set(sid, {
                        student: student.student,
                        attendance: []
                    });
                }
            });
        });

        // Build attendance matrix
        studentMap.forEach((data, studentId) => {
            sessions.forEach(session => {
                const studentRecord = session.students.find(
                    s => s.student._id.toString() === studentId
                );
                data.attendance.push(studentRecord?.status || 'N/A');
            });
        });

        // Generate CSV rows
        studentMap.forEach((data) => {
            const student = data.student;
            const attendance = data.attendance;

            const present = attendance.filter(a => a === 'present' || a === 'late').length;
            const absent = attendance.filter(a => a === 'absent').length;
            const percentage = sessions.length > 0
                ? Math.round((present / sessions.length) * 100)
                : 0;

            csv += `${student.regNo},"${student.name}",${student.email}`;

            attendance.forEach(status => {
                csv += `,${status.charAt(0).toUpperCase()}`;
            });

            csv += `,${present},${absent},${percentage}%\n`;
        });

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${sectionId}_${Date.now()}.csv`);

        res.status(200).send(csv);
    } else {
        // Option 1: Use your HF Report Generation API (for excel/pdf)
        // Note: generateAttendanceReport is not defined in this file - implement or import it
        // For now, fallback to a simple JSON response or error if not implemented
        return res.status(501).json({
            success: false,
            message: `Format '${format}' not yet implemented. Use 'csv' for now.`
        });

        // Uncomment and implement this once generateAttendanceReport is available:
        /*
        const reportResult = await generateAttendanceReport(sectionId, {
            startDate,
            endDate,
            courseId,
            format // 'excel', 'pdf', or 'csv'
        });

        if (!reportResult.success) {
            return res.status(500).json({
                success: false,
                message: "Failed to generate report",
                error: reportResult.error
            });
        }

        // Set appropriate headers based on format
        const contentTypes = {
            excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            pdf: 'application/pdf',
            csv: 'text/csv'
        };

        const extensions = {
            excel: 'xlsx',
            pdf: 'pdf',
            csv: 'csv'
        };

        res.setHeader('Content-Type', contentTypes[format] || contentTypes.excel);
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=attendance_report_${sectionId}_${Date.now()}.${extensions[format] || 'xlsx'}`
        );

        res.status(200).send(reportResult.reportData);
        */
    }
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
    UnlockAttendance,
    UpdateStudentAttendance,
    DeleteAttendanceSession,
    GetAttendanceStatistics,
    ExportAttendanceReport
};