import { Teacher } from "../modules/Teacher.js";
import { Section } from "../modules/Section.js";
import { Course } from "../modules/Course.js";
import { asyncHandler } from "../asyncHandler.js";

/**
 * ✅ Add a new teacher
 * - Validates data
 * - Prevents duplicate email/employeeId
 * - Syncs with Section and Course collections
 */
const addTeacher = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    password,
    employeeId,
    department,
    // ⬇️ FIXED: Changed to 'sections'
    sections = [],
    role = "Faculty",
    // ⬇️ FIXED: Changed to 'courses'
    courses = [],
  } = req.body || {};

  // 🔹 Validate required fields
  if (!name || !email || !password || !employeeId || !department) {
    return res.status(400).json({
      success: false,
      message: "Required fields: name, email, password, employeeId, department",
    });
  }

  // 🔹 Check for duplicates (email / employeeId)
  const existing = await Teacher.findOne({
    $or: [{ email: email.toLowerCase() }, { employeeId }],
  });

  if (existing) {
    return res.status(409).json({
      success: false,
      message: "Teacher with this email or employee ID already exists",
    });
  }

  // 🔹 Create new teacher
  const teacher = await Teacher.create({
    name,
    email: email.toLowerCase(),
    password,
    employeeId,
    department,
    // ⬇️ FIXED: Changed to 'sections'
    sections,
    role,
    // ⬇️ FIXED: Changed to 'courses'
    courses,
  });

  // 🔹 Sync teacher reference to all linked sections
  // ⬇️ FIXED: Changed to 'sections'
  if (sections.length > 0) {
    await Section.updateMany(
      { _id: { $in: sections } },
      // ⚠️ WARNING: This 'Teacher' (uppercase T) field is likely
      // inconsistent with your other lowercase fields.
      // You should check your Section model.
      { $set: { Teacher: teacher._id } }
    );
  }

  // 🔹 Sync teacher reference in each related course
  // ⬇️ FIXED: Changed to 'courses'
  if (courses.length > 0) {
    await Course.updateMany(
      { _id: { $in: courses } },
      { $addToSet: { teachers: teacher._id } }
    );
  }

  // ⬇️ FIXED: Corrected both populate paths
  const populated = await Teacher.findById(teacher._id)
    .populate("sections", "SectionName RoomNo Course") // <-- 'sections' (lowercase)
    .populate("courses", "CourseName courseCode");    // <-- 'courses' (plural) & correct fields

  return res.status(201).json({
    success: true,
    message: "Teacher added successfully",
    data: populated,
  });
});
const getTeacherByEmail = asyncHandler(async (req, res) => {
  const { email } = req.params || {};

  // Validate input
  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email parameter is required in the URL.",
    });
  }

  // Case-insensitive email search
  const teacher = await Teacher.findOne({
    email: { $regex: new RegExp(`^${email}$`, "i") },
  })
    .populate({
      path: "sections",
      select: "SectionName RoomNo Course",
      populate: { path: "Course", select: "CourseName courseCode" },
    })
    .populate({
      path: "courses",
      select: "CourseName courseCode department semester",
    });

  // Handle not found
  if (!teacher) {
    return res.status(404).json({
      success: false,
      message: `No teacher found with email: ${email}`,
    });
  }

  // Respond
  return res.status(200).json({
    success: true,
    message: "Teacher fetched successfully",
    data: teacher,
  });
});
export { 
          addTeacher,
          getTeacherByEmail
 };

// ... (Your other controller functions like getTeacher, updateTeacher, etc.)