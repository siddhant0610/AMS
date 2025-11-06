import mongoose from "mongoose";
import { Section } from "../modules/Section.js";
import { Student } from "../modules/Student.js";
import { Teacher } from "../modules/Teacher.js";
import { Course } from "../modules/Course.js";

/**
 * Data Integrity Rebuilder
 * Repairs relationships between Students, Sections, Courses, and Teachers
 */

export const rebuildRelations = async () => {
  console.log("🔁 Starting full data relationship rebuild...");

  let fixedCourses = 0;
  let fixedSections = 0;
  let fixedTeachers = 0;
  let fixedStudents = 0;
  let cleanedReferences = 0;

  try {
    const sections = await Section.find()
      .populate("Course")
      .populate("Teacher")
      .populate("Student.Reg_No");

    for (const section of sections) {
      const course = section.Course;
      const teacher = section.Teacher;

      // ✅ 1️⃣ Sync Section → Course
      if (course) {
        const courseInDb = await Course.findById(course._id);
        if (courseInDb && !courseInDb.sections.includes(section._id)) {
          await Course.findByIdAndUpdate(course._id, {
            $addToSet: { sections: section._id },
          });
          fixedCourses++;
        }
      }

      // ✅ 2️⃣ Sync Section → Teacher
      if (teacher) {
        const teacherInDb = await Teacher.findById(teacher._id);
        if (teacherInDb && !teacherInDb.sections.includes(section._id)) {
          await Teacher.findByIdAndUpdate(teacher._id, {
            $addToSet: { sections: section._id },
          });
          fixedTeachers++;
        }
        // Also ensure teacher has this course
        if (teacherInDb && course && !teacherInDb.courses.includes(course._id)) {
          await Teacher.findByIdAndUpdate(teacher._id, {
            $addToSet: { courses: course._id },
          });
          fixedTeachers++;
        }
      }

      // ✅ 3️⃣ Sync Section → Students
      if (section.Student && section.Student.length > 0 && course) {
        for (const stuRef of section.Student) {
          if (!stuRef.Reg_No) continue;
          const student = await Student.findById(stuRef.Reg_No);

          if (student) {
            const alreadyEnrolled = student.enrolledCourses.some(
              (ec) =>
                ec.course?.toString() === course._id.toString() &&
                ec.section?.toString() === section._id.toString()
            );

            if (!alreadyEnrolled) {
              await Student.findByIdAndUpdate(stuRef.Reg_No, {
                $addToSet: {
                  enrolledCourses: {
                    course: course._id,
                    section: section._id,
                  },
                },
              });
              fixedStudents++;
            }
          } else {
            // Remove invalid student ref
            await Section.findByIdAndUpdate(section._id, {
              $pull: { Student: { Reg_No: stuRef.Reg_No } },
            });
            cleanedReferences++;
          }
        }
      }

      fixedSections++;
    }

    // ✅ 4️⃣ Cleanup stale course/teacher refs
    const allTeacherIds = (await Teacher.find({}, "_id")).map((t) => t._id);
    const allCourseIds = (await Course.find({}, "_id")).map((c) => c._id);
    const allSectionIds = (await Section.find({}, "_id")).map((s) => s._id);

    await Teacher.updateMany(
      {},
      {
        $pull: {
          courses: { $nin: allCourseIds },
          sections: { $nin: allSectionIds },
        },
      }
    );

    await Course.updateMany(
      {},
      { $pull: { teachers: { $nin: allTeacherIds }, sections: { $nin: allSectionIds } } }
    );

    console.log("✅ Relationship rebuild completed successfully.");

    return {
      success: true,
      summary: {
        fixedCourses,
        fixedSections,
        fixedTeachers,
        fixedStudents,
        cleanedReferences,
      },
    };
  } catch (error) {
    console.error("❌ Error rebuilding relationships:", error.message);
    return {
      success: false,
      message: error.message,
    };
  }
};
