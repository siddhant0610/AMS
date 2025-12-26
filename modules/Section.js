import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate";
import { Student } from "./Student.js";
import { Teacher } from "./Teacher.js";
import { Course } from "./Course.js";

// ===============================
// SCHEMA DEFINITION
// ===============================
const SectionSchema = new mongoose.Schema(
  {
    SectionName: { type: String, required: true, },
    // section can have multiple courses and teachers 
    Course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true
    },

    Teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: true
    },

    Student: [
      {
        Reg_No: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Student",
          required: true
        },
        attendance: {
          type: Boolean,
          default: false
        }
      }
    ],

    RoomNo: { type: String, required: true },
    Building: { type: String, required: true },

    Day: [
      {
        Day: {
          type: [String],
          enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday","Saturday","Sunday"],
          required: true
        },
        startTime: { type: String, required: true },
        endTime: { type: String, required: true },
        completed: { type: String, enum: ["C", "P", "NA"], default: "NA" }
      }
    ],

    capacity: {
      type: Number,
      default: 60
    }
  },
  { timestamps: true }
);

SectionSchema.plugin(mongooseAggregatePaginate);

// ===============================
// AUTO-SYNC MIDDLEWARE
// ===============================

// Helper flag to prevent circular updates
let isSyncing = false;

// ✅ POST-SAVE HOOK: Sync with Students, Teacher, and Course
SectionSchema.post("save", async function (doc) {
  if (isSyncing) return; // prevent circular updates
  isSyncing = true;

  try {
    const sectionId = doc._id;
    const courseId = doc.Course;
    const teacherId = doc.Teacher;

    // 1️⃣ Sync Students — Add enrolledCourses entries
    if (doc.Student && doc.Student.length > 0) {
      const studentIds = doc.Student.map((s) => s.Reg_No);
      await Student.updateMany(
        { _id: { $in: studentIds } },
        {
          $addToSet: {
            enrolledCourses: {
              course: courseId,
              section: sectionId
            }
          }
        }
      );
    }

    // 2️⃣ Sync Teacher — Add section if not present
    await Teacher.findByIdAndUpdate(
      teacherId,
      { $addToSet: { Sections: sectionId } },
      { new: true }
    );

    // 3️⃣ Sync Course — Add section reference
    await Course.findByIdAndUpdate(
      courseId,
      { $addToSet: { Sections: sectionId } },
      { new: true }
    );

    console.log(`✅ Auto-synced Section(${sectionId}) with Students, Teacher, and Course`);
  } catch (error) {
    console.error("❌ Section sync error:", error.message);
  } finally {
    isSyncing = false;
  }
});

// ✅ POST-REMOVE HOOK: Clean up relationships when section deleted
SectionSchema.post("findOneAndDelete", async function (doc) {
  if (!doc) return;
  if (isSyncing) return;
  isSyncing = true;

  try {
    const sectionId = doc._id;
    const courseId = doc.Course;
    const teacherId = doc.Teacher;

    // 1️⃣ Remove section from students' enrolledCourses
    await Student.updateMany(
      { "enrolledCourses.section": sectionId },
      { $pull: { enrolledCourses: { section: sectionId } } }
    );

    // 2️⃣ Remove section reference from Teacher
    await Teacher.findByIdAndUpdate(teacherId, {
      $pull: { Sections: sectionId }
    });

    // 3️⃣ Remove section reference from Course
    await Course.findByIdAndUpdate(courseId, {
      $pull: { Sections: sectionId }
    });

    console.log(`🧹 Cleaned up Section(${sectionId}) from linked models`);
  } catch (error) {
    console.error("❌ Cleanup error after Section deletion:", error.message);
  } finally {
    isSyncing = false;
  }
});

export const Section = mongoose.model("Section", SectionSchema);
