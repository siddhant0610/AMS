import { Section } from "../modules/Section.js";
import { Student } from "../modules/Student.js";
import { Course } from "../modules/Course.js";
import { Teacher } from "../modules/Teacher.js";
import { asyncHandler } from "../asyncHandler.js";
import mongoose from "mongoose";

// ✅ Create a new section
export const CreateSection = asyncHandler(async (req, res) => {
  const { SectionName, Student: students, Course: courseId, Teacher: teacherId, RoomNo, Day } = req.body;

  // Validate fields
  if (!SectionName || !RoomNo || !Day || !Array.isArray(Day) || Day.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Required fields: SectionName, RoomNo, and Day (array of schedule objects)"
    });
  }

  // Validate Day time format
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  for (const schedule of Day) {
    if (!schedule.Day || !schedule.startTime || !schedule.endTime) {
      return res.status(400).json({
        success: false,
        message: "Each schedule must include Day, startTime, and endTime"
      });
    }
    if (!timeRegex.test(schedule.startTime) || !timeRegex.test(schedule.endTime)) {
      return res.status(400).json({
        success: false,
        message: "Invalid time format. Use HH:MM (e.g., 09:30)"
      });
    }
  }

  // Validate referenced entities
  const course = await Course.findById(courseId);
  const teacher = await Teacher.findById(teacherId);
  if (!course || !teacher) {
    return res.status(404).json({
      success: false,
      message: "Invalid Course or Teacher reference"
    });
  }

  // Create Section
  const createdSection = await Section.create({
    SectionName,
    Student: students || [],
    Course: courseId,
    Teacher: teacherId,
    RoomNo,
    Day
  });

  // ✅ Auto-sync for all linked students
  if (students && students.length > 0) {
    await Student.updateMany(
      { _id: { $in: students.map((s) => s.Reg_No) } },
      {
        $push: {
          enrolledCourses: {
            course: courseId,
            section: createdSection._id
          }
        }
      }
    );
  }

  const populated = await Section.findById(createdSection._id)
    .populate("Student.Reg_No", "name regNo email")
    .populate("Course", "courseName courseCode")
    .populate("Teacher", "name email");

  return res.status(201).json({
    success: true,
    message: "Section created successfully",
    data: populated
  });
});

// ✅ Get all sections
export const GetAllSections = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, day, completed } = req.query;

  const filter = {};
  if (day) filter["Day.Day"] = day;
  if (completed !== undefined) filter["Day.completed"] = completed === "true";

  const sections = await Section.find(filter)
    .populate("Student.Reg_No", "name regNo email")
    .populate("Course", "courseName courseCode")
    .populate("Teacher", "name email")
    .limit(parseInt(limit))
    .skip((page - 1) * parseInt(limit))
    .sort({ createdAt: -1 });

  const total = await Section.countDocuments(filter);

  return res.status(200).json({
    success: true,
    data: sections,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit)
    }
  });
});

// ✅ Get section by ID
export const GetSection = asyncHandler(async (req, res) => {
  const section = await Section.findById(req.params.id)
    .populate("Student.Reg_No", "name regNo email department Semester")
    .populate("Course", "courseName courseCode credits")
    .populate("Teacher", "name email department");

  if (!section) {
    return res.status(404).json({
      success: false,
      message: "Section not found"
    });
  }

  return res.status(200).json({ success: true, data: section });
});

// ✅ Update section
export const UpdateSection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const section = await Section.findById(id);
  if (!section)
    return res.status(404).json({ success: false, message: "Section not found" });

  // Validate Day array if present
  if (req.body.Day && Array.isArray(req.body.Day)) {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    for (const d of req.body.Day) {
      if ((d.startTime && !timeRegex.test(d.startTime)) || (d.endTime && !timeRegex.test(d.endTime))) {
        return res.status(400).json({
          success: false,
          message: "Invalid time format. Use HH:MM"
        });
      }
    }
  }

  const updated = await Section.findByIdAndUpdate(id, req.body, {
    new: true,
    runValidators: true
  })
    .populate("Student.Reg_No", "name regNo email")
    .populate("Course", "courseName courseCode")
    .populate("Teacher", "name email");

  return res.status(200).json({
    success: true,
    message: "Section updated successfully",
    data: updated
  });
});

// ✅ Delete section
export const DeleteSection = asyncHandler(async (req, res) => {
  const section = await Section.findByIdAndDelete(req.params.id);
  if (!section)
    return res.status(404).json({ success: false, message: "Section not found" });

  // Remove section from students' enrolledCourses
  await Student.updateMany(
    { "enrolledCourses.section": section._id },
    { $pull: { enrolledCourses: { section: section._id } } }
  );

  return res.status(200).json({
    success: true,
    message: "Section deleted successfully",
    data: section
  });
});

// ✅ Add student to section
export const AddStudentToSection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { studentId } = req.body;

  const section = await Section.findById(id).populate("Course");
  const student = await Student.findById(studentId);

  if (!section || !student) {
    return res.status(404).json({
      success: false,
      message: "Section or Student not found"
    });
  }

  const alreadyExists = section.Student.some(
    (s) => s.Reg_No.toString() === studentId
  );

  if (alreadyExists)
    return res.status(400).json({
      success: false,
      message: "Student already enrolled in this section"
    });

  section.Student.push({ Reg_No: studentId });
  await section.save();

  // Add to student's enrolledCourses
  await Student.findByIdAndUpdate(studentId, {
    $addToSet: {
      enrolledCourses: {
        course: section.Course._id,
        section: section._id
      }
    }
  });

  const updated = await Section.findById(id)
    .populate("Student.Reg_No", "name regNo email")
    .populate("Course", "courseName courseCode")
    .populate("Teacher", "name email");

  return res.status(200).json({
    success: true,
    message: "Student added successfully",
    data: updated
  });
});

// ✅ Remove student from section
export const RemoveStudentFromSection = asyncHandler(async (req, res) => {
  const { id, studentId } = req.params;

  const section = await Section.findById(id);
  if (!section)
    return res.status(404).json({ success: false, message: "Section not found" });

  section.Student = section.Student.filter(
    (s) => s.Reg_No.toString() !== studentId
  );
  await section.save();

  // Remove from student's enrolledCourses
  await Student.findByIdAndUpdate(studentId, {
    $pull: { enrolledCourses: { section: section._id } }
  });

  const updated = await Section.findById(id)
    .populate("Student.Reg_No", "name regNo email")
    .populate("Course", "courseName courseCode")
    .populate("Teacher", "name email");

  return res.status(200).json({
    success: true,
    message: "Student removed from section successfully",
    data: updated
  });
});

// ✅ Mark attendance for a student
export const MarkAttendance = asyncHandler(async (req, res) => {
  const { id, studentId } = req.params;
  const { attendance } = req.body;

  const section = await Section.findById(id);
  if (!section)
    return res.status(404).json({ success: false, message: "Section not found" });

  const student = section.Student.find((s) => s.Reg_No.toString() === studentId);
  if (!student)
    return res.status(404).json({
      success: false,
      message: "Student not found in this section"
    });

  student.attendance = attendance;
  await section.save();

  return res.status(200).json({
    success: true,
    message: "Attendance updated successfully",
    data: section
  });
});

// ✅ Mark section schedule completed
export const MarkSectionCompleted = asyncHandler(async (req, res) => {
  const { id, scheduleIndex } = req.params;

  const section = await Section.findById(id);
  if (!section)
    return res.status(404).json({ success: false, message: "Section not found" });

  if (!section.Day[scheduleIndex]) {
    return res.status(400).json({
      success: false,
      message: "Invalid schedule index"
    });
  }

  section.Day[scheduleIndex].completed = true;
  await section.save();

  return res.status(200).json({
    success: true,
    message: "Schedule marked as completed",
    data: section
  });
});
