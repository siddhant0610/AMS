import { Section } from "../modules/Section.js";
import { Student } from "../modules/Student.js";
import { Course } from "../modules/Course.js";
import { Teacher } from "../modules/Teacher.js";
import { asyncHandler } from "../asyncHandler.js";
import mongoose from "mongoose";

/* ==========================================================
   ✅ CREATE SECTION
========================================================== */
export const CreateSection = asyncHandler(async (req, res) => {
  const { SectionName, Student: students, Course: courseId, Teacher: teacherId, RoomNo, Day } = req.body;

  if (!SectionName || !RoomNo || !Day || !Array.isArray(Day) || Day.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Required fields: SectionName, RoomNo, and Day (array of schedule objects)",
    });
  }

  const course = await Course.findById(courseId);
  const teacher = await Teacher.findById(teacherId);
  if (!course || !teacher) {
    return res.status(404).json({
      success: false,
      message: "Invalid Course or Teacher reference",
    });
  }

  const createdSection = await Section.create({
    SectionName,
    Student: students || [],
    Course: courseId,
    Teacher: teacherId,
    RoomNo,
    Day,
  });

  // 🔁 Auto-sync relationships
  await Course.findByIdAndUpdate(courseId, { $addToSet: { sections: createdSection._id } });
  await Teacher.findByIdAndUpdate(teacherId, { $addToSet: { Sections: createdSection._id } });

  if (students?.length > 0) {
    await Student.updateMany(
      { _id: { $in: students.map((s) => s.Reg_No) } },
      { $addToSet: { enrolledCourses: { course: courseId, section: createdSection._id } } }
    );
  }

  const populated = await Section.findById(createdSection._id)
    .populate("Student.Reg_No", "name regNo email department Semester")
    .populate("Course", "CourseName courseCode department")
    .populate("Teacher", "name email department");

  res.status(201).json({
    success: true,
    message: "Section created successfully",
    data: populated,
  });
});

/* ==========================================================
   ✅ GET ALL SECTIONS
========================================================== */
export const GetAllSections = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, day, completed } = req.query;
  const filter = {};

  if (day) filter["Day.Day"] = day;
  if (completed !== undefined) filter["Day.completed"] = completed === "true";

  const sections = await Section.find(filter)
    .populate("Student.Reg_No", "name regNo email")
    .populate("Course", "CourseName courseCode")
    .populate("Teacher", "name email")
    .limit(parseInt(limit))
    .skip((page - 1) * parseInt(limit))
    .sort({ createdAt: -1 });

  const total = await Section.countDocuments(filter);

  res.status(200).json({
    success: true,
    data: sections,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
    },
  });
});

export const getSections = asyncHandler(async (req, res) => {
  // 1. Get the Names from the URL Query
  const { courseName, branch } = req.query;
  
  // Validate input
  if (!courseName) {
      return res.status(400).json({ success: false, message: "courseName is required" });
  }

  // ---------------------------------------------------------
  // STEP 1: Find the Course ID using the Name & Branch
  // ---------------------------------------------------------
  const courseFilter = { 
      // Make it case-insensitive so "java" finds "Java"
      CourseName: { $regex: new RegExp(courseName, "i") } 
  };
  
  if (branch) {
      courseFilter.branch = branch;
  }

  const targetCourse = await Course.findOne(courseFilter);

  // If no course matches that name, return empty immediately
  if (!targetCourse) {
      return res.status(404).json({ 
          success: false, 
          message: "Course not found",
          data: [] 
      });
  }

  // ---------------------------------------------------------
  // STEP 2: Find Sections using the Found Course ID
  // ---------------------------------------------------------
  const sections = await Section.find({ Course: targetCourse._id })
      .populate("Teacher", "name email");

  // ---------------------------------------------------------
  // STEP 3: Return Result
  // ---------------------------------------------------------
  res.status(200).json({
    success: true,
    count: sections.length,
    data: sections.map(sec => ({

        sectionName: sec.SectionName,
        courseName: targetCourse.CourseName 
    }))
  });
});
/* ==========================================================
   ✅ UPDATE SECTION
========================================================== */
export const UpdateSection = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const section = await Section.findById(id);
  if (!section)
    return res.status(404).json({ success: false, message: "Section not found" });

  // Validate schedule format
  if (req.body.Day && Array.isArray(req.body.Day)) {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    for (const d of req.body.Day) {
      if ((d.startTime && !timeRegex.test(d.startTime)) || (d.endTime && !timeRegex.test(d.endTime))) {
        return res.status(400).json({ success: false, message: "Invalid time format. Use HH:MM" });
      }
    }
  }

  const updated = await Section.findByIdAndUpdate(id, req.body, {
    new: true,
    runValidators: true,
  })
    .populate("Student.Reg_No", "name regNo email")
    .populate("Course", "CourseName courseCode")
    .populate("Teacher", "name email");

  res.status(200).json({
    success: true,
    message: "Section updated successfully",
    data: updated,
  });
});
/* ==========================================================
   ✅ ADD SCHEDULE (DAYS) TO EXISTING SECTION
   Route: PUT /api/v1/section/:id/schedule
========================================================== */
export const AddScheduleToSection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { Day } = req.body; // Expecting an array of schedule objects

  // 1️⃣ Validation
  if (!Day || !Array.isArray(Day) || Day.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Please provide a 'Day' array with schedule objects.",
    });
  }

  // Validate time format (HH:MM)
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  for (const d of Day) {
    if (!d.Day || !d.startTime || !d.endTime) {
      return res.status(400).json({ success: false, message: "Each schedule must have Day, startTime, and endTime." });
    }
    if (!timeRegex.test(d.startTime) || !timeRegex.test(d.endTime)) {
      return res.status(400).json({ success: false, message: "Invalid time format. Use HH:MM (e.g., 09:00)." });
    }
  }

  // 2️⃣ Find and Update
  // We use $push with $each to append multiple new days at once
  const updatedSection = await Section.findByIdAndUpdate(
    id,
    {
      $push: {
        Day: { $each: Day }
      }
    },
    { new: true, runValidators: true }
  )
    .populate("Course", "CourseName courseCode")
    .populate("Teacher", "name");

  if (!updatedSection) {
    return res.status(404).json({ success: false, message: "Section not found" });
  }

  res.status(200).json({
    success: true,
    message: "New schedule days added successfully",
    data: updatedSection,
  });
});
/* ==========================================================
   ✅ DELETE SECTION
========================================================== */
export const DeleteSection = asyncHandler(async (req, res) => {
  const section = await Section.findByIdAndDelete(req.params.id);
  if (!section)
    return res.status(404).json({ success: false, message: "Section not found" });

  await Course.findByIdAndUpdate(section.Course, { $pull: { sections: section._id } });
  await Teacher.updateMany({ Sections: section._id }, { $pull: { Sections: section._id } });
  await Student.updateMany(
    { "enrolledCourses.section": section._id },
    { $pull: { enrolledCourses: { section: section._id } } }
  );

  res.status(200).json({
    success: true,
    message: "Section deleted and references cleaned successfully",
    data: section,
  });
});

/* ==========================================================
   ✅ ADD STUDENT TO SECTION
========================================================== */
export const AddStudentToSection = asyncHandler(async (req, res) => {
  const { SectionName } = req.params;     // Section ID
  const { regNo } = req.body; // Student's _id (or regNo, depending on your frontend)

  // 1. Fetch Section & Student (Validation)
  const section = await Section.findOne({ SectionName }).populate("Course");
  const student = await Student.findOne({ regNo });
  if (!section || !student) {
    return res.status(404).json({ success: false, message: "Section or Student not found" });
  }

  // 2. CHECK: Is student already in the Roster?
  // We check the SECTION's list only.
  const exists = section.Student.some((s) => s.Reg_No.toString() === student._id.toString());
  if (exists) {
    return res.status(400).json({ success: false, message: "Student already enrolled" });
  }

  // 3. UPDATE: Add to Section Roster ONLY
  // This is the "Single Source of Truth". We do NOT touch the Student document.
  section.Student.push({ Reg_No: student._id });
  if (!section.Building) {
    section.Building = "Main Block"; // Or any default value
  }
  await section.save();

  // 4. Return Updated Data
  // We populate everything so the frontend updates immediately
  const updated = await Section.findOne({ SectionName })
    .populate("Student.Reg_No", "name regNo email")
    .populate("Course", "CourseName courseCode")
    .populate("Teacher", "name email");

  res.status(200).json({
    success: true,
    message: "Student added to section successfully",
    data: updated,
  });
});
/* ==========================================================
   ✅ REMOVE STUDENT FROM SECTION
========================================================== */
export const RemoveStudentFromSection = asyncHandler(async (req, res) => {
  const { id, studentId } = req.params;

  const section = await Section.findById(id);
  if (!section)
    return res.status(404).json({ success: false, message: "Section not found" });

  section.Student = section.Student.filter((s) => s.Reg_No.toString() !== studentId);
  await section.save();

  await Student.findByIdAndUpdate(studentId, {
    $pull: { enrolledCourses: { section: section._id } },
  });

  const updated = await Section.findById(id)
    .populate("Student.Reg_No", "name regNo email")
    .populate("Course", "CourseName courseCode")
    .populate("Teacher", "name email");

  res.status(200).json({
    success: true,
    message: "Student removed successfully",
    data: updated,
  });
});

