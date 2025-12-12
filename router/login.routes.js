import express from "express";
import {
  loginUser,
  getMe,
  logoutUser
} from "../controller/auth.controller.js";
import { verifyJWT } from "../MiddleWares/authentication.js";

const router = express.Router();

// Public routes
router.post("/", loginUser);
//router.post("/refresh", refreshAccessToken);
router.post("/logout", logoutUser);

// Protected routes
router.get("/me", verifyJWT, getMe);
//router.get("/secure/ping", verifyJWT, securePing);

export default router;
