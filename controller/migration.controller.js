import { Submission } from "../modules/Submission.js";
import { Student } from "../modules/Student.js";
import { User } from "../modules/User.js";
import { asyncHandler } from "../asyncHandler.js";
import bcrypt from "bcrypt";

export const migrateSubmissionsToUsers = asyncHandler(async (req, res) => {
    try {
        // 1. Fetch all submissions from the DB
        const allSubmissions = await Submission.find({});
        
        if (!allSubmissions || allSubmissions.length === 0) {
            return res.status(404).json({ message: "No submissions found to migrate." });
        }

        console.log(`🚀 Starting migration for ${allSubmissions.length} students...`);

        let createdCount = 0;
        let skippedCount = 0;
        let errors = [];

        // 2. Loop through each submission
        for (const sub of allSubmissions) {
            // Data Validation: Ensure vital fields exist
            if (!sub.registrationNumber || !sub.name) {
                console.warn(`⚠️ Skipping submission ${sub._id}: Missing RegNo or Name`);
                errors.push(`ID ${sub._id}: Missing Data`);
                continue;
            }

            // ------------------------------------------
            // 🧩 DATA GENERATION LOGIC
            // ------------------------------------------
            
            // A. Generate Email (Since it's missing in Submission schema)
            // Format: firstname.regNo@jaipur.manipal.edu (Customize this domain!)
            // We use optional chaining because 'email' might exist in some submissions
            const email = sub.email || `${sub.name.split(" ")[0].toLowerCase()}.${sub.registrationNumber}@jaipur.manipal.edu`;

            // B. Generate Password (name.regNo)
            // Example: "bhavishya.2427010200"
            const rawPassword = `${sub.name.split(" ")[0].toLowerCase()}.${sub.registrationNumber}`;
            const hashedPassword = await bcrypt.hash(rawPassword, 10);

            // ------------------------------------------
            // 🔍 DUPLICATE CHECK
            // ------------------------------------------
            const userExists = await User.findOne({ email });
            const studentExists = await Student.findOne({ regNo: sub.registrationNumber });

            if (userExists || studentExists) {
                skippedCount++;
                continue; // Skip this student, they are already migrated
            }

            // ------------------------------------------
            // 💾 DB OPERATIONS
            // ------------------------------------------
            try {
                // 1. Create Student Profile
                const newStudent = await Student.create({
                    name: sub.name,
                    regNo: sub.registrationNumber,
                    email: email,
                    // Map Submission fields to Student Schema
                    // Note: Your submission uses 'Section' (Capital), Student might use 'section' (Lower)
                    // You might need to fetch the Section ID based on the letter "G" here if your schema requires ObjectId
                    // For now, assuming you store the String or have a helper:
                    enrolledCourses: [] 
                });

                // 2. Create User Login
                await User.create({
                    name: sub.name,
                    email: email,
                    password: hashedPassword,
                    role: "student", // Force role
                    studentProfile: newStudent._id
                });

                createdCount++;
                console.log(`✅ Migrated: ${sub.name} (${sub.registrationNumber})`);

            } catch (err) {
                console.error(`❌ Failed to migrate ${sub.registrationNumber}:`, err.message);
                errors.push(`${sub.registrationNumber}: ${err.message}`);
            }
        }

        // 3. Final Report
        return res.status(200).json({
            success: true,
            message: "Migration process completed.",
            report: {
                total_submissions: allSubmissions.length,
                successfully_created: createdCount,
                skipped_duplicates: skippedCount,
                errors: errors
            }
        });

    } catch (error) {
        console.error("Global Migration Error:", error);
        return res.status(500).json({ message: "Migration failed", error: error.message });
    }
});
