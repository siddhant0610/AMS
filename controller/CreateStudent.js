import { Student } from "../modules/Student.js";
import { Section } from "../modules/Section.js";
import { asyncHandler } from "../asyncHandler.js";

const CreateStudent = asyncHandler(async (req, res) => {
    const { name, email, regNo, course, department, Semester, password, sectionId } = req.body;
    
    // Validate required fields
    if (!name || !email || !regNo || !course || !department || !Semester || !password) {
        return res.status(400).json({
            success: false,
            message: "All fields are required"
        });
    }

    // Check if student already exists
    const existingStudent = await Student.findOne({ 
        $or: [{ email }, { regNo }] 
    });
    
    if (existingStudent) {
        return res.status(409).json({
            success: false,
            message: "Student with this email or registration number already exists"
        });
    }

    // Create the student
    const created = await Student.create(req.body);

    // If sectionId is provided, add student to that section
    if (sectionId) {
        const section = await Section.findById(sectionId);
        
        if (!section) {
            // Student created but section not found
            return res.status(201).json({
                success: true,
                message: "Student created but section not found",
                data: created,
                warning: "Section ID is invalid"
            });
        }

        // Check if student already in section
        const alreadyInSection = section.Student.some(
            s => s.Reg_No.toString() === created._id.toString()
        );

        if (!alreadyInSection) {
            section.Student.push({
                Reg_No: created._id,
                attendance: false
            });
            await section.save();
        }

        return res.status(201).json({
            success: true,
            message: "Student created and added to section successfully",
            data: created,
            section: {
                id: section._id,
                name: section.SectionName
            }
        });
    }

    // Student created without section assignment
    res.status(201).json({
        success: true,
        message: "Student created successfully",
        data: created
    });
});

export { CreateStudent };