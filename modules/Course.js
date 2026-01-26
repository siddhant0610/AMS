import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate";
import { Section } from "./Section.js";
import { Student } from "./Student.js";
import { Teacher } from "./Teacher.js";

const CourseSchema = new mongoose.Schema(
  {
    courseCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },
    CourseName: {
      type: String,
      required: true,
      trim: true
    },
    branch: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "CSE",
        "AIML",
        "DS",
        "Civil",
        "IT",
        "Electronics"
      ]
    },
    credits: {
      type: Number,
      required: true,
      min: 1,
      max: 6
    },
    year: {
      type: Number,
      required: true,
      min: 1,
      max: 8
    },
    description: {
      type: String
    },

    // Linked sections
    sections: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Section"
      }
    ],

    // Multiple teachers can teach this course
    teachers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Teacher"
      }
    ],

    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

// Virtual for enrolled students (via Sections)
CourseSchema.virtual("enrolledStudents", {
  ref: "Section",
  localField: "_id",
  foreignField: "Course",
  justOne: false
});

CourseSchema.plugin(mongooseAggregatePaginate);

// ===============================
// AUTO-SYNC MIDDLEWARE
// ===============================
let isSyncing = false;

// ✅ POST-SAVE HOOK: Sync with Sections, Teachers, and Students
CourseSchema.post("save", async function (doc) {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const courseId = doc._id;

    // 1️⃣ Ensure all linked sections have correct Course reference
    if (doc.sections && doc.sections.length > 0) {
      await Section.updateMany(
        { _id: { $in: doc.sections } },
        { $set: { Course: courseId } }
      );
    }

    // 2️⃣ Sync Teachers — ensure each teacher knows they are teaching this course
    if (doc.teachers && doc.teachers.length > 0) {
      await Teacher.updateMany(
        { _id: { $in: doc.teachers } },
        { $addToSet: { course: courseId } }
      );
    }

    // 3️⃣ Sync enrolled students (via linked sections)
    const linkedSections = await Section.find({ Course: courseId }).populate(
      "Student.Reg_No",
      "_id"
    );
    const allStudents = linkedSections.flatMap((s) =>
      s.Student.map((stu) => stu.Reg_No)
    );

    if (allStudents.length > 0) {
      await Student.updateMany(
        { _id: { $in: allStudents } },
        {
          $addToSet: {
            enrolledCourses: {
              course: courseId,
              section: { $each: linkedSections.map((s) => s._id) }
            }
          }
        }
      );
    }

    console.log(`✅ Auto-synced Course(${doc.courseCode}) with linked Sections, Teachers, and Students`);
  } catch (error) {
    console.error("❌ Course sync error:", error.message);
  } finally {
    isSyncing = false;
  }
});

// ✅ POST-REMOVE HOOK: Cleanup relationships when course deleted
CourseSchema.post("findOneAndDelete", async function (doc) {
  if (!doc) return;
  if (isSyncing) return;
  isSyncing = true;

  try {
    const courseId = doc._id;

    // 1️⃣ Remove this course from students’ enrolledCourses
    await Student.updateMany(
      { "enrolledCourses.course": courseId },
      { $pull: { enrolledCourses: { course: courseId } } }
    );

    // 2️⃣ Remove this course from Teachers’ course lists
    if (doc.teachers && doc.teachers.length > 0) {
      await Teacher.updateMany(
        { _id: { $in: doc.teachers } },
        { $pull: { course: courseId } }
      );
    }

    // 3️⃣ Remove the course reference from linked sections
    await Section.updateMany({ Course: courseId }, { $unset: { Course: "" } });

    console.log(`🧹 Cleaned up Course(${doc.courseCode}) from Students, Teachers, and Sections`);
  } catch (error) {
    console.error("❌ Course cleanup error:", error.message);
  } finally {
    isSyncing = false;
  }
});

export const Course = mongoose.model("Course", CourseSchema);
