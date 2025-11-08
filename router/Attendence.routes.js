import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

import {
  CreateAttendanceSession,
  MarkAttendanceWithFace,
  AttendanceReport,
} from "../controller/Attendence.Marked.js";

const router = express.Router();

// --------------------
// 🔹 FILE UPLOAD SETUP
// --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../../public/temp"));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB max
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/jpg"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPG and PNG images are allowed"));
    }
    cb(null, true);
  },
});

// Ensure temp folder exists
import fs from "fs";
const TEMP_UPLOAD_DIR = path.join(__dirname, "../../public/temp");
if (!fs.existsSync(TEMP_UPLOAD_DIR)) fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

// --------------------
// 🔹 ROUTES
// --------------------

// ✅ 1. Create new attendance session
// Example: POST /api/attendance/create
router.post("/create", CreateAttendanceSession);

// ✅ 2. Mark attendance using face recognition
// Example: POST /api/attendance/mark-face/:attendanceId
router.post("/mark-face/:attendanceId", upload.array("file",3), MarkAttendanceWithFace);

// ✅ 3. Export attendance report (Excel)
// Example: GET /api/attendance/export/:sectionId
router.get("/export/:sectionId", AttendanceReport);

export default router;
