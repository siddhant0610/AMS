import { asyncHandler } from "../asyncHandler.js";
import { Section } from "../modules/Section.js";
import { Student } from "../modules/Student.js";

const AttendenceMarked = asyncHandler(async (req, res) => {
  const { Reg_No, SectionName, Course } = req.body;

  if (!Reg_No || !SectionName || !Course) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  console.log("Marking attendance for:", Reg_No, SectionName, Course);

  
  // ✅ Update attendance for matched student
  const section = await Section.findOneAndUpdate(
    {
      $or: [
        { SectionName },
        { Course },
        { "Student.Reg_No": Reg_No },
      ],
    },
    { $set: { "Student.$.attendance": true } },
    { new: true }
  );
  

  if (!section) {
    return res.status(404).json({ message: "Section or student not found" });
  }

  // ✅ (Optional) Set attendance = false for other students in the same section
  await Section.updateOne(
    {
      _id: section._id,
    },
    {
      $set: { "Student.$[elem].attendance": false },
    },
    {
      arrayFilters: [{ "elem.Reg_No": { $ne: Reg_No } }],
    }
  );

  // ✅ Return updated section (or only updated student if you prefer)
  return res.status(200).json({
    message: "Attendance marked successfully",
    section,
  });
});

export { AttendenceMarked };
