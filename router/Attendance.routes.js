import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

import {
    markAttendanceWithFace, 
    getMyAttendance,
    getSessionDetails,
    checkAttendanceStatus,
    addPermanentSlot,
    createAdHocSession
} from "../controller/Attendance.controller.js";

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
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExt = [".jpg", ".jpeg", ".png"];

  if (!allowedExt.includes(ext)) {
    return cb(new Error("Only JPG and PNG images are allowed"));
  }

  cb(null, true);
},
});

// Ensure temp folder exists
import fs from "fs";
import { verifyJWT } from "../MiddleWares/authentication.js";
const TEMP_UPLOAD_DIR = path.join(__dirname, "../../public/temp");
if (!fs.existsSync(TEMP_UPLOAD_DIR)) fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

// --------------------
// 🔹 ROUTES
// --------------------

// ✅ 2. Mark attendance using face recognition
// Example: POST /api/attendance/mark-face/:attendanceId
router.post("/mark-face/:attendanceId", verifyJWT,upload.array("images",4), markAttendanceWithFace);
router.get("/my",verifyJWT, verifyJWT,getMyAttendance);
router.get("/session/:id", verifyJWT,getSessionDetails);
// I will add timetable route later
router.post("/create_class_temp",verifyJWT,createAdHocSession)
router.post("/add-permanent", verifyJWT,addPermanentSlot);
router.get("/status/:id", verifyJWT,checkAttendanceStatus);
// ✅ 3. Export attendance report (Excel)
// Example: GET /api/attendance/export/:sectionId
//router.get("/export/:sectionId", AttendanceReport);

export default router;