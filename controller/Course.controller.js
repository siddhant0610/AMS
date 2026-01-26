import { Course } from "../modules/Course.js";
import { Section } from "../modules/Section.js";
import { Student } from "../modules/Student.js";
import { asyncHandler } from "../asyncHandler.js";

/* ========================================================
   ✅ CREATE COURSE
======================================================== */
const CreateCourse = asyncHandler(async (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({
      success: false,
      message: "Request body is empty. Please send JSON data.",
    });
  }

  const courseCode =
    req.body.courseCode?.trim().toUpperCase() ||
    req.body.CourseCode?.trim().toUpperCase();
  const CourseName =
    req.body.CourseName?.trim() || req.body.courseName?.trim();
  const branch = req.body.branch?.trim();
  const credits = req.body.credits;
  const year = req.body.year;
  const description = req.body.description || "";
  const teachers = req.body.teachers || []; // ✅ supports multiple teachers now

  if (!courseCode || !CourseName || !branch || !credits || !year) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required fields. Please provide: courseCode, CourseName, branch, credits, year",
    });
  }

  const existing = await Course.findOne({ courseCode });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: `Course with code ${courseCode} already exists`,
    });
  }

  const created = await Course.create({
    courseCode,
    CourseName,
    branch,
    credits,
    year,
    description,
    teachers,
  });

  const populated = await Course.findById(created._id)
    .populate("sections", "SectionName Teacher RoomNo")
    .populate("teachers", "name email department");

  return res.status(201).json({
    success: true,
    message: "Course created successfully",
    data: populated,
  });
});

/* ========================================================
   ✅ GET ALL COURSES
======================================================== */
const GetAllCourses = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, department, semester, isActive } = req.query;

  const filter = {};
  if (branch) filter.branch = branch;
  if (semester) filter.semester = parseInt(semester);
  if (isActive !== undefined) filter.isActive = isActive === "true";

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    sort: { createdAt: -1 },
  };

  const courses = await Course.find(filter)
    .populate("sections", "SectionName Teacher RoomNo")
    .populate("teachers", "name email")
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

const getCourses = asyncHandler(async (req, res) => {
  // 1. Extract filters from the URL Query String
  const { year, branch } = req.query;

  // 2. Build a filter object
  // If year/branch exists, add it to the filter. If not, it stays empty (find all).
  const filter = {};
  if (year) filter.year = year;     // Make sure your DB field is 'year' (lowercase/uppercase?)
  if (branch) filter.branch = branch;

  // 3. Pass the filter to .find()
  const courses = await Course.find(filter);

  res.status(200).json({
    success: true,
    count: courses.length,
    data: courses
  });
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
    .populate("teachers", "name email");

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
    .populate("teachers", "name email");

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
   ✅ EXPORT
======================================================== */
export {
  CreateCourse,
  GetAllCourses,
  getCourses,
  UpdateCourse,
  DeleteCourse,
  AddSectionToCourse,
  GetCourseStudents
};
