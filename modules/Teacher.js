import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate";
import { Section } from "./Section.js";
import { Course } from "./Course.js";

// ===============================
// TEACHER SCHEMA
// ===============================
const TeacherSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    // password: {
    //   type: String,
    //   required: true,
    //   minlength: 6
    // },
    employeeId: {
      type: String,
      required: true,
      unique: true
    },
    department: {
      type: String,
      required: true
    },

    // Courses this teacher teaches
    courses: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Course"
      }
    ],

    // Sections this teacher handles
    sections: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Section"
      }
    ],
    designation:{ type:String},
    role: {
      type: String,
      enum:['student', 'admin','teacher'],
      default: "teacher"
    }
  },
  { timestamps: true }
);

// Plugin for aggregation pagination
TeacherSchema.plugin(mongooseAggregatePaginate);

// ===============================
// AUTO-SYNC MIDDLEWARE
// ===============================
let isSyncing = false;

// ✅ POST-SAVE HOOK: Ensure bidirectional sync
TeacherSchema.post("save", async function (doc) {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const teacherId = doc._id;

    // 1️⃣ Sync Courses → ensure teacher is listed in each course’s teacher array
    if (doc.courses && doc.courses.length > 0) {
      await Course.updateMany(
        { _id: { $in: doc.courses } },
        { $addToSet: { teachers: teacherId } }
      );
    }

    // 2️⃣ Sync Sections → ensure teacher is linked to each section
    if (doc.sections && doc.sections.length > 0) {
      await Section.updateMany(
        { _id: { $in: doc.sections } },
        { $set: { Teacher: teacherId } }
      );
    }

    console.log(`✅ Auto-synced Teacher(${doc.name}) with Courses and Sections`);
  } catch (error) {
    console.error("❌ Teacher sync error:", error.message);
  } finally {
    isSyncing = false;
  }
});

// ✅ POST-REMOVE HOOK: Clean up on teacher deletion
TeacherSchema.post("findOneAndDelete", async function (doc) {
  if (!doc) return;
  if (isSyncing) return;
  isSyncing = true;

  try {
    const teacherId = doc._id;

    // 1️⃣ Remove teacher reference from Courses
    await Course.updateMany(
      { teachers: teacherId },
      { $pull: { teachers: teacherId } }
    );

    // 2️⃣ Remove teacher from Sections
    await Section.updateMany(
      { Teacher: teacherId },
      { $unset: { Teacher: "" } }
    );

    console.log(`🧹 Cleaned up Teacher(${doc.name}) from Courses and Sections`);
  } catch (error) {
    console.error("❌ Teacher cleanup error:", error.message);
  } finally {
    isSyncing = false;
  }
});

export const Teacher = mongoose.model("Teacher", TeacherSchema);
