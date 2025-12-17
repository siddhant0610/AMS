// // middleware/auth.middleware.js
import jwt from "jsonwebtoken";
import { User } from "../modules/User.js";
import { ApiError } from "../utils/api.Error.js";
import { asyncHandler } from "../asyncHandler.js";


export const verifyJWT = asyncHandler(async (req, res, next) => {
  // ... (token extraction code) ...

  const token = req.cookies?.token || req.header("Authorization")?.replace("Bearer ", "");

  if (!token) throw new ApiError(401, "Unauthorized request");

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // // 👇 ADD THESE DEBUG LOGS 👇
    // console.log("-----------------------------------------");
    // console.log("🕵️ MIDDLEWARE DEBUGGER");
    // console.log("1. Decoded Token:", decoded);
    // console.log("2. Searching DB for ID:", decoded.id || decoded._id);

    // // Attempt to find user
    const user = await User.findById(decoded.id || decoded._id).select("-password");

    // console.log("3. User Found in DB:", user); 
    // console.log("-----------------------------------------");
    req.user = user;
    if (!user) {
      // This is line 30 where your error comes from
      throw new ApiError(401, "User not found");
    }
    next();
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid access token");
  }
});