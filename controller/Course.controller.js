import { Course } from "../modules/Course.js";
import { Section } from "../modules/Section.js";
import { Student } from "../modules/Student.js";
import { asyncHandler } from "../asyncHandler.js";

// Create a new course
const CreateCourse = asyncHandler(async (req, res) => {
    const { courseCode, CourseName, department, credits, semester, description, primaryTeacher } = req.body;
    
    // Validate required fields
    if (!courseCode || !CourseName || !department || !credits || !semester) {
        return res.status(400).json({
            success: false,
            message: "Please provide all required fields: courseCode, CourseName, department, credits, semester"
        });
    }

    // Check if course already exists
    const existingCourse = await Course.findOne({ courseCode: courseCode.toUpperCase() });
    if (existingCourse) {
        return res.status(409).json({
            success: false,
            message: "Course with this code already exists"
        });
    }

    // Create the course
    const created = await Course.create(req.body);

    // Populate references
    const populatedCourse = await Course.findById(created._id)
        .populate('sections')
        .populate('primaryTeacher', 'name email');

    res.status(201).json({
        success: true,
        message: "Course created successfully",
        data: populatedCourse
    });
});

// Get all courses with pagination
const GetAllCourses = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, department, semester, isActive } = req.query;

    // Build filter
    const filter = {};
    if (department) filter.department = department;
    if (semester) filter.semester = parseInt(semester);
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        populate: [
            { path: 'sections', select: 'SectionName Teacher RoomNo' },
            { path: 'primaryTeacher', select: 'name email' }
        ],
        sort: { createdAt: -1 }
    };

    const courses = await Course.find(filter)
        .populate('sections', 'SectionName Teacher RoomNo')
        .populate('primaryTeacher', 'name email')
        .limit(options.limit)
        .skip((options.page - 1) * options.limit)
        .sort(options.sort);

    const total = await Course.countDocuments(filter);

    res.status(200).json({
        success: true,
        data: courses,
        pagination: {
            total,
            page: options.page,
            limit: options.limit,
            totalPages: Math.ceil(total / options.limit)
        }
    });
});

// Get a single course by ID
const GetCourse = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const course = await Course.findById(id)
        .populate({
            path: 'sections',
            populate: [
                { path: 'Student.Reg_No', select: 'name regNo email' },
                { path: 'Teacher', select: 'name email' }
            ]
        })
        .populate('primaryTeacher', 'name email department');

    if (!course) {
        return res.status(404).json({
            success: false,
            message: "Course not found"
        });
    }

    res.status(200).json({
        success: true,
        data: course
    });
});

// Get course by course code
const GetCourseByCode = asyncHandler(async (req, res) => {
    const { courseCode } = req.params;

    const course = await Course.findOne({ courseCode: courseCode.toUpperCase() })
        .populate({
            path: 'sections',
            populate: [
                { path: 'Student.Reg_No', select: 'name regNo email' },
                { path: 'Teacher', select: 'name email' }
            ]
        })
        .populate('primaryTeacher', 'name email department');

    if (!course) {
        return res.status(404).json({
            success: false,
            message: "Course not found"
        });
    }

    res.status(200).json({
        success: true,
        data: course
    });
});

// Update a course
const UpdateCourse = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check if course exists
    const course = await Course.findById(id);
    if (!course) {
        return res.status(404).json({
            success: false,
            message: "Course not found"
        });
    }

    // If updating course code, check for duplicates
    if (req.body.courseCode && req.body.courseCode !== course.courseCode) {
        const duplicate = await Course.findOne({ 
            courseCode: req.body.courseCode.toUpperCase(),
            _id: { $ne: id }
        });
        
        if (duplicate) {
            return res.status(409).json({
                success: false,
                message: "Course code already exists"
            });
        }
    }

    // Update the course
    const updated = await Course.findByIdAndUpdate(
        id,
        req.body,
        { new: true, runValidators: true }
    )
        .populate('sections', 'SectionName Teacher RoomNo')
        .populate('primaryTeacher', 'name email');

    res.status(200).json({
        success: true,
        message: "Course updated successfully",
        data: updated
    });
});

// Delete a course
const DeleteCourse = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const course = await Course.findById(id);
    if (!course) {
        return res.status(404).json({
            success: false,
            message: "Course not found"
        });
    }

    // Check if course has sections
    if (course.sections && course.sections.length > 0) {
        return res.status(400).json({
            success: false,
            message: "Cannot delete course with existing sections. Please remove all sections first."
        });
    }

    await Course.findByIdAndDelete(id);

    res.status(200).json({
        success: true,
        message: "Course deleted successfully",
        data: course
    });
});

// Add section to course
const AddSectionToCourse = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { sectionId } = req.body;

    if (!sectionId) {
        return res.status(400).json({
            success: false,
            message: "Section ID is required"
        });
    }

    // Check if section exists
    const section = await Section.findById(sectionId);
    if (!section) {
        return res.status(404).json({
            success: false,
            message: "Section not found"
        });
    }

    // Check if course exists
    const course = await Course.findById(id);
    if (!course) {
        return res.status(404).json({
            success: false,
            message: "Course not found"
        });
    }

    // Check if section already linked to course
    if (course.sections.includes(sectionId)) {
        return res.status(409).json({
            success: false,
            message: "Section already linked to this course"
        });
    }

    // Add section to course
    course.sections.push(sectionId);
    await course.save();

    // Update section's course reference
    section.Course = id;
    await section.save();

    const updatedCourse = await Course.findById(id)
        .populate('sections', 'SectionName Teacher RoomNo')
        .populate('primaryTeacher', 'name email');

    res.status(200).json({
        success: true,
        message: "Section added to course successfully",
        data: updatedCourse
    });
});

// Get all students enrolled in a course (from all sections)
const GetCourseStudents = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const course = await Course.findById(id)
        .populate({
            path: 'sections',
            populate: {
                path: 'Student.Reg_No',
                select: 'name regNo email department Semester'
            }
        });

    if (!course) {
        return res.status(404).json({
            success: false,
            message: "Course not found"
        });
    }

    // Collect all unique students from all sections
    const studentMap = new Map();
    
    course.sections.forEach(section => {
        section.Student.forEach(student => {
            if (student.Reg_No) {
                studentMap.set(
                    student.Reg_No._id.toString(), 
                    student.Reg_No
                );
            }
        });
    });

    const students = Array.from(studentMap.values());

    res.status(200).json({
        success: true,
        data: {
            course: {
                _id: course._id,
                courseCode: course.courseCode,
                CourseName: course.CourseName
            },
            totalStudents: students.length,
            students: students
        }
    });
});

// Get course statistics
const GetCourseStats = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const course = await Course.findById(id)
        .populate({
            path: 'sections',
            populate: {
                path: 'Student.Reg_No Teacher'
            }
        });

    if (!course) {
        return res.status(404).json({
            success: false,
            message: "Course not found"
        });
    }

    // Calculate statistics
    const stats = {
        courseCode: course.courseCode,
        courseName: course.CourseName,
        totalSections: course.sections.length,
        totalStudents: 0,
        sectionWiseStudents: []
    };

    course.sections.forEach(section => {
        const studentCount = section.Student.length;
        stats.totalStudents += studentCount;
        
        stats.sectionWiseStudents.push({
            sectionName: section.SectionName,
            teacher: section.Teacher ? section.Teacher.name : 'Not assigned',
            studentCount: studentCount,
            roomNo: section.RoomNo
        });
    });

    res.status(200).json({
        success: true,
        data: stats
    });
});

export {
    CreateCourse,
    GetAllCourses,
    GetCourse,
    GetCourseByCode,
    UpdateCourse,
    DeleteCourse,
    AddSectionToCourse,
    GetCourseStudents,
    GetCourseStats
};