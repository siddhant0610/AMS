import { Course } from "../modules/Course.js";
import { Section } from "../modules/Section.js";
import { Student } from "../modules/Student.js";
import { asyncHandler } from "../asyncHandler.js";

/* ========================================================
   ✅ CREATE COURSE
======================================================== */
const CreateCourse = asyncHandler(async (req, res) => {
  // Ensure body is defined
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({
      success: false,
      message: "Request body is empty. Please send JSON data.",
    });
  }

  // Support both camelCase & PascalCase keys
  const courseCode =
    req.body.courseCode?.trim().toUpperCase() ||
    req.body.CourseCode?.trim().toUpperCase();
  const CourseName =
    req.body.CourseName?.trim() || req.body.courseName?.trim();
  const department = req.body.department?.trim();
  const credits = req.body.credits;
  const semester = req.body.semester;
  const description = req.body.description || "";
  const primaryTeacher = req.body.primaryTeacher;

  // Validation
  if (!courseCode || !CourseName || !department || !credits || !semester) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required fields. Please provide: courseCode, CourseName, department, credits, semester",
      received: req.body,
    });
  }

  // Check duplicates
  const existing = await Course.findOne({ courseCode });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: `Course with code ${courseCode} already exists`,
    });
  }

  // Create course
  const created = await Course.create({
    courseCode,
    CourseName,
    department,
    credits,
    semester,
    description,
    primaryTeacher,
  });

  const populated = await Course.findById(created._id)
    .populate("sections", "SectionName Teacher RoomNo")
    .populate("primaryTeacher", "name email department");

  return res.status(201).json({
    success: true,
    message: "Course created successfully",
    data: populated,
  });
});

/* ========================================================
   ✅ GET ALL COURSES (with pagination + filters)
======================================================== */
const GetAllCourses = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, department, semester, isActive } = req.query;

  const filter = {};
  if (department) filter.department = department;
  if (semester) filter.semester = parseInt(semester);
  if (isActive !== undefined) filter.isActive = isActive === "true";

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    sort: { createdAt: -1 },
  };

  const courses = await Course.find(filter)
    .populate("sections", "SectionName Teacher RoomNo")
    .populate("primaryTeacher", "name email")
    .limit(options.limit)
    .skip((options.page - 1) * options.limit)
    .sort(options.sort);

  const total = await Course.countDocuments(filter);

  return res.status(200).json({
    success: true,
    data: courses,
    pagination: {
      total,
      page: options.page,
      limit: options.limit,
      totalPages: Math.ceil(total / options.limit),
    },
  });
});

/* ========================================================
   ✅ GET COURSE BY ID
======================================================== */
const GetCourse = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const course = await Course.findById(id)
    .populate({
      path: "sections",
      populate: [
        { path: "Student.Reg_No", select: "name regNo email" },
        { path: "Teacher", select: "name email" },
      ],
    })
    .populate("primaryTeacher", "name email department");

  if (!course) {
    return res.status(404).json({ success: false, message: "Course not found" });
  }

  return res.status(200).json({ success: true, data: course });
});

/* ========================================================
   ✅ GET COURSE BY CODE
======================================================== */
const GetCourseByCode = asyncHandler(async (req, res) => {
  const { courseCode } = req.params;

  const course = await Course.findOne({
    courseCode: courseCode.toUpperCase(),
  })
    .populate({
      path: "sections",
      populate: [
        { path: "Student.Reg_No", select: "name regNo email" },
        { path: "Teacher", select: "name email" },
      ],
    })
    .populate("primaryTeacher", "name email department");

  if (!course) {
    return res.status(404).json({ success: false, message: "Course not found" });
  }

  return res.status(200).json({ success: true, data: course });
});

/* ========================================================
   ✅ UPDATE COURSE
======================================================== */
const UpdateCourse = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const course = await Course.findById(id);
  if (!course)
    return res.status(404).json({ success: false, message: "Course not found" });

  if (req.body.courseCode && req.body.courseCode !== course.courseCode) {
    const duplicate = await Course.findOne({
      courseCode: req.body.courseCode.toUpperCase(),
      _id: { $ne: id },
    });
    if (duplicate)
      return res.status(409).json({ success: false, message: "Course code already exists" });
  }

  const updated = await Course.findByIdAndUpdate(id, req.body, {
    new: true,
    runValidators: true,
  })
    .populate("sections", "SectionName Teacher RoomNo")
    .populate("primaryTeacher", "name email");

  return res.status(200).json({
    success: true,
    message: "Course updated successfully",
    data: updated,
  });
});

/* ========================================================
   ✅ DELETE COURSE
======================================================== */
const DeleteCourse = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const course = await Course.findById(id);
  if (!course)
    return res.status(404).json({ success: false, message: "Course not found" });

  if (course.sections && course.sections.length > 0) {
    return res.status(400).json({
      success: false,
      message:
        "Cannot delete course with existing sections. Please remove all sections first.",
    });
  }

  await Course.findByIdAndDelete(id);
  return res.status(200).json({
    success: true,
    message: "Course deleted successfully",
    data: course,
  });
});

/* ========================================================
   ✅ ADD SECTION TO COURSE
======================================================== */
const AddSectionToCourse = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { sectionId } = req.body;

  if (!sectionId)
    return res.status(400).json({
      success: false,
      message: "Section ID is required",
    });

  const section = await Section.findById(sectionId);
  if (!section)
    return res.status(404).json({ success: false, message: "Section not found" });

  const course = await Course.findById(id);
  if (!course)
    return res.status(404).json({ success: false, message: "Course not found" });

  if (course.sections.includes(sectionId)) {
    return res.status(409).json({
      success: false,
      message: "Section already linked to this course",
    });
  }

  course.sections.push(sectionId);
  await course.save();

  section.Course = id;
  await section.save();

  const updated = await Course.findById(id)
    .populate("sections", "SectionName Teacher RoomNo")
    .populate("primaryTeacher", "name email");

  return res.status(200).json({
    success: true,
    message: "Section added to course successfully",
    data: updated,
  });
});

/* ========================================================
   ✅ GET COURSE STUDENTS
======================================================== */
const GetCourseStudents = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const course = await Course.findById(id).populate({
    path: "sections",
    populate: {
      path: "Student.Reg_No",
      select: "name regNo email department Semester",
    },
  });

  if (!course)
    return res.status(404).json({ success: false, message: "Course not found" });

  const studentMap = new Map();

  course.sections.forEach((section) => {
    section.Student.forEach((student) => {
      if (student.Reg_No)
        studentMap.set(student.Reg_No._id.toString(), student.Reg_No);
    });
  });

  const students = Array.from(studentMap.values());

  return res.status(200).json({
    success: true,
    data: {
      course: {
        _id: course._id,
        courseCode: course.courseCode,
        CourseName: course.CourseName,
      },
      totalStudents: students.length,
      students,
    },
  });
});

/* ========================================================
   ✅ COURSE STATS
======================================================== */
const GetCourseStats = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const course = await Course.findById(id).populate({
    path: "sections",
    populate: { path: "Student.Reg_No Teacher" },
  });

  if (!course)
    return res.status(404).json({ success: false, message: "Course not found" });

  const stats = {
    courseCode: course.courseCode,
    courseName: course.CourseName,
    totalSections: course.sections.length,
    totalStudents: 0,
    sectionWiseStudents: [],
  };

  course.sections.forEach((section) => {
    const studentCount = section.Student.length;
    stats.totalStudents += studentCount;
    stats.sectionWiseStudents.push({
      sectionName: section.SectionName,
      teacher: section.Teacher ? section.Teacher.name : "Not assigned",
      studentCount,
      roomNo: section.RoomNo,
    });
  });

  return res.status(200).json({ success: true, data: stats });
});

/* ========================================================
   ✅ EXPORT
======================================================== */
export {
  CreateCourse,
  GetAllCourses,
  GetCourse,
  GetCourseByCode,
  UpdateCourse,
  DeleteCourse,
  AddSectionToCourse,
  GetCourseStudents,
  GetCourseStats,
};
