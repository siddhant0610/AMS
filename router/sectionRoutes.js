import express from 'express';
import {
    CreateSection,
    GetAllSections,
     UpdateSection,
     getSections,
    DeleteSection,
    AddStudentToSection,
    RemoveStudentFromSection,
    AddScheduleToSection
} from '../controller/SectionContoller.js';

import { verifyJWT } from '../MiddleWares/authentication.js';
const router = express.Router();

// Basic CRUD
router.post('/', CreateSection);
router.get('/allSections', GetAllSections);
router.get('/sections',verifyJWT, getSections);
router.put('/:id', UpdateSection);
router.delete('/:id', DeleteSection);
router.put('/:id/schedule', AddScheduleToSection);

// Student management
router.post('/:SectionName/add', AddStudentToSection);
router.delete('/:id/students/:studentId', RemoveStudentFromSection);
export default router;