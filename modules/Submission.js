import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema({
  // ... your existing schema fields ...
  student: { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
  name: { type: String, required: true }
}, { timestamps: true });

// 👇 THE FIX: Switch to the 'test' database for this specific model
const testDB = mongoose.connection.useDb("test");

export const Submission = testDB.model("Submission", submissionSchema);