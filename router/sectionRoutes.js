import express from 'express';
import {
    CreateSection,
    GetAllSections,
    GetSection,
    UpdateSection,
    DeleteSection,
    AddStudentToSection,
    RemoveStudentFromSection,
    MarkAttendance,
    MarkSectionCompleted,
    AddScheduleToSection
} from '../controller/SectionContoller.js';

const router = express.Router();

// Basic CRUD
router.post('/', CreateSection);
router.get('/', GetAllSections);
router.get('/:id', GetSection);
router.put('/:id', UpdateSection);
router.delete('/:id', DeleteSection);
router.put('/:id/schedule', AddScheduleToSection);

// Student management
router.post('/:id/students', AddStudentToSection);
router.delete('/:id/students/:studentId', RemoveStudentFromSection);

// Attendance
router.patch('/:id/attendance/:studentId', MarkAttendance);

// Mark completed
router.patch('/:id/complete', MarkSectionCompleted);

export default router;