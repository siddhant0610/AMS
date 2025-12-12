// middleware/auth.middleware.js
import jwt from "jsonwebtoken";
import { User } from "../modules/User.js";
import { ApiError } from "../utils/api.Error.js";
import { asyncHandler } from "../asyncHandler.js";

export const verifyJWT = asyncHandler(async (req, res, next) => {
  // 1️⃣ Extract token from Cookie OR Header
  // Note: I changed 'accessToken' to 'token' to match the Login controller above
  const token =
    req.cookies?.token || 
    req.header("Authorization")?.replace(/Bearer\s+/i, "").trim();

  if (!token) {
    throw new ApiError(401, "Unauthorized — No token provided");
  }

  // 2️⃣ Verify token
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  } catch (err) {
    throw new ApiError(401, "Invalid or expired token");
  }

  // 3️⃣ Fetch user
  const user = await User.findById(decoded.id).select("-password");

  if (!user) {
    throw new ApiError(401, "User not found");
  }

  req.user = user;
  next();
});