import { Section } from "../modules/Section.js";
import { Student } from "../modules/Student.js";
import { Course } from "../modules/Course.js";
import { Teacher } from "../modules/Teacher.js";
import { asyncHandler } from "../asyncHandler.js";

// Create a new section
const CreateSection = asyncHandler(async (req, res) => {
    const { SectionName, Student: students, Course, Teacher, RoomNo, Day } = req.body;
    
    // Validate required fields
    if (!SectionName || !RoomNo || !Day || !Array.isArray(Day) || Day.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Please provide all required fields: SectionName, RoomNo, Day (array of schedule objects)"
        });
    }

    // Validate each time slot
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    for (const schedule of Day) {
        if (!schedule.Day || !schedule.startTime || !schedule.endTime) {
            return res.status(400).json({
                success: false,
                message: "Each schedule must have Day, startTime, and endTime"
            });
        }
        
        if (!timeRegex.test(schedule.startTime) || !timeRegex.test(schedule.endTime)) {
            return res.status(400).json({
                success: false,
                message: "Invalid time format. Use HH:MM format (e.g., 10:00)"
            });
        }
    }

    // Create the section
    const created = await Section.create(req.body);

    // Populate references
    const populatedSection = await Section.findById(created._id)
        .populate('Student.Reg_No', 'name regNo email')
        .populate('Course', 'courseName courseCode')
        .populate('Teacher', 'name email');

    res.status(201).json({
        success: true,
        message: "Section created successfully",
        data: populatedSection
    });
});

// Get all sections with pagination
const GetAllSections = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, day, completed } = req.query;

    // Build filter
    const filter = {};
    if (day) filter['Day.Day'] = day;
    if (completed !== undefined) filter['Day.completed'] = completed === 'true';

    const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        populate: [
            { path: 'Student.Reg_No', select: 'name regNo email' },
            { path: 'Course', select: 'courseName courseCode' },
            { path: 'Teacher', select: 'name email' }
        ],
        sort: { createdAt: -1 }
    };

    const sections = await Section.find(filter)
        .populate('Student.Reg_No', 'name regNo email')
        .populate('Course', 'courseName courseCode')
        .populate('Teacher', 'name email')
        .limit(options.limit)
        .skip((options.page - 1) * options.limit)
        .sort(options.sort);

    const total = await Section.countDocuments(filter);

    res.status(200).json({
        success: true,
        data: sections,
        pagination: {
            total,
            page: options.page,
            limit: options.limit,
            totalPages: Math.ceil(total / options.limit)
        }
    });
});

// Get a single section by ID
const GetSection = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const section = await Section.findById(id)
        .populate('Student.Reg_No', 'name regNo email course department Semester')
        .populate('Course', 'courseName courseCode credits')
        .populate('Teacher', 'name email department');

    if (!section) {
        return res.status(404).json({
            success: false,
            message: "Section not found"
        });
    }

    res.status(200).json({
        success: true,
        data: section
    });
});

// Update a section
const UpdateSection = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check if section exists
    const section = await Section.findById(id);
    if (!section) {
        return res.status(404).json({
            success: false,
            message: "Section not found"
        });
    }

    // Validate time slots if Day array is being updated
    if (req.body.Day && Array.isArray(req.body.Day)) {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        for (const schedule of req.body.Day) {
            if (schedule.startTime && !timeRegex.test(schedule.startTime)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid time format. Use HH:MM format"
                });
            }
            if (schedule.endTime && !timeRegex.test(schedule.endTime)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid time format. Use HH:MM format"
                });
            }
        }
    }

    // Update the section
    const updated = await Section.findByIdAndUpdate(
        id,
        req.body,
        { new: true, runValidators: true }
    )
        .populate('Student.Reg_No', 'name regNo email')
        .populate('Course', 'courseName courseCode')
        .populate('Teacher', 'name email');

    res.status(200).json({
        success: true,
        message: "Section updated successfully",
        data: updated
    });
});

// Delete a section
const DeleteSection = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const section = await Section.findByIdAndDelete(id);

    if (!section) {
        return res.status(404).json({
            success: false,
            message: "Section not found"
        });
    }

    res.status(200).json({
        success: true,
        message: "Section deleted successfully",
        data: section
    });
});

// Add student to section
const AddStudentToSection = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { studentId } = req.body;

    if (!studentId) {
        return res.status(400).json({
            success: false,
            message: "Student ID is required"
        });
    }

    // Check if student exists
    const student = await Student.findById(studentId);
    if (!student) {
        return res.status(404).json({
            success: false,
            message: "Student not found"
        });
    }

    // Check if section exists
    const section = await Section.findById(id);
    if (!section) {
        return res.status(404).json({
            success: false,
            message: "Section not found"
        });
    }

    // Check if student already in section
    const studentExists = section.Student.some(
        s => s.Reg_No.toString() === studentId
    );

    if (studentExists) {
        return res.status(409).json({
            success: false,
            message: "Student already enrolled in this section"
        });
    }

    // Add student
    section.Student.push({
        Reg_No: studentId,
        attendance: false
    });

    await section.save();

    const updatedSection = await Section.findById(id)
        .populate('Student.Reg_No', 'name regNo email')
        .populate('Course', 'courseName courseCode')
        .populate('Teacher', 'name email');

    res.status(200).json({
        success: true,
        message: "Student added to section successfully",
        data: updatedSection
    });
});

// Remove student from section
const RemoveStudentFromSection = asyncHandler(async (req, res) => {
    const { id, studentId } = req.params;

    const section = await Section.findById(id);
    if (!section) {
        return res.status(404).json({
            success: false,
            message: "Section not found"
        });
    }

    // Remove student
    section.Student = section.Student.filter(
        s => s.Reg_No.toString() !== studentId
    );

    await section.save();

    const updatedSection = await Section.findById(id)
        .populate('Student.Reg_No', 'name regNo email')
        .populate('Course', 'courseName courseCode')
        .populate('Teacher', 'name email');

    res.status(200).json({
        success: true,
        message: "Student removed from section successfully",
        data: updatedSection
    });
});

// Mark attendance for a student in a section
const MarkAttendance = asyncHandler(async (req, res) => {
    const { id, studentId } = req.params;
    const { attendance } = req.body;

    if (attendance === undefined) {
        return res.status(400).json({
            success: false,
            message: "Attendance status (true/false) is required"
        });
    }

    const section = await Section.findById(id);
    if (!section) {
        return res.status(404).json({
            success: false,
            message: "Section not found"
        });
    }

    // Find and update student attendance
    const studentIndex = section.Student.findIndex(
        s => s.Reg_No.toString() === studentId
    );

    if (studentIndex === -1) {
        return res.status(404).json({
            success: false,
            message: "Student not found in this section"
        });
    }

    section.Student[studentIndex].attendance = attendance;
    await section.save();

    const updatedSection = await Section.findById(id)
        .populate('Student.Reg_No', 'name regNo email')
        .populate('Course', 'courseName courseCode')
        .populate('Teacher', 'name email');

    res.status(200).json({
        success: true,
        message: "Attendance marked successfully",
        data: updatedSection
    });
});

// Mark section schedule as completed
const MarkSectionCompleted = asyncHandler(async (req, res) => {
    const { id, scheduleIndex } = req.params;

    const section = await Section.findById(id);
    
    if (!section) {
        return res.status(404).json({
            success: false,
            message: "Section not found"
        });
    }

    if (!section.Day[scheduleIndex]) {
        return res.status(404).json({
            success: false,
            message: "Schedule not found"
        });
    }

    section.Day[scheduleIndex].completed = true;
    await section.save();

    const updatedSection = await Section.findById(id)
        .populate('Student.Reg_No', 'name regNo email')
        .populate('Course', 'courseName courseCode')
        .populate('Teacher', 'name email');

    res.status(200).json({
        success: true,
        message: "Schedule marked as completed",
        data: updatedSection
    });
});

export {
    CreateSection,
    GetAllSections,
    GetSection,
    UpdateSection,
    DeleteSection,
    AddStudentToSection,
    RemoveStudentFromSection,
    MarkAttendance,
    MarkSectionCompleted
};