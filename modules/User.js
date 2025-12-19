// models/User.js
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  //id:{type: String, required: true, unique: true, lowercase: true, trim: true},
  // store active refresh tokens (you can limit size or store hashes in prod)
  refreshTokens: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
  role:{type: String, enum: ['student', 'admin','teacher'], default: 'teacher' }
});

export const User = mongoose.model("User", UserSchema);
// create a primary key for ams that is unique and used for search 