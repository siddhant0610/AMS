import express from "express";
import {
  loginUser,
  getMe,
  logoutUser,
  addUser
} from "../controller/auth.controller.js";
import { verifyJWT } from "../MiddleWares/authentication.js";

const loginRoute = express.Router();
loginRoute.post("/signup", addUser)
// Public routes
loginRoute.post("/", loginUser);
//loginRoute.post("/refresh", refreshAccessToken);
loginRoute.post("/logout", logoutUser);

// Protected routes
loginRoute.get("/me", verifyJWT, getMe);
//loginRoute.get("/secure/ping", verifyJWT, securePing);

export default loginRoute;
