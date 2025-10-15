import { Student } from "../modules/Student.js";
import { asyncHandler } from "../asyncHandler.js";

const CreateStudent = asyncHandler(async (req, res) => {
    const { name, regNo, email, course, department, Semester, password } = req.body;
    
    // Validate required fields
    if (!name || !regNo || !email || !course || !department || !Semester || !password) {
        return res.status(400).json({
            success: false,
            message: "All fields are required",
            required: ["name", "regNo", "email", "course", "department", "Semester", "password"],
            received: req.body
        });
    }

    // Create the student
    const created = await Student.create(req.body);

    // Send success response
    res.status(201).json({
        success: true,
        message: "Student created successfully",
        data: created
    });
});

export { CreateStudent };