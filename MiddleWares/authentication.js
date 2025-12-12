// middleware/auth.middleware.js
import jwt from "jsonwebtoken";
import { User } from "../modules/User.js";
import { ApiError } from "../utils/api.Error.js";
import { asyncHandler } from "../asyncHandler.js";

/**
 * ✅ Middleware: verifyJWT
 * 
 * Supports:
 *  - Cookie-based JWT (req.cookies.accessToken)
 *  - Bearer token in Authorization header
 * 
 * Verifies token → Checks user → Attaches req.user
 */
export const verifyJWT = asyncHandler(async (req, res, next) => {
  // 1️⃣ Extract token
  const token =
    req.cookies?.accessToken ||
    req.header("Authorization")?.replace(/Bearer\s+/i, "").trim();

  if (!token) throw new ApiError(401, "Unauthorized — No access token provided");

  // 2️⃣ Verify token
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError")
      throw new ApiError(401, "Access token expired — please log in again");
    if (err.name === "JsonWebTokenError")
      throw new ApiError(401, "Invalid access token");
    throw new ApiError(401, "Failed to verify token");
  }

  // 3️⃣ Fetch user
  const user = await User.findById(decoded?.id || decoded?._id).select(
    "-password -refreshToken"
  );

  if (!user) throw new ApiError(401, "User not found — invalid or outdated token");

  // 4️⃣ Attach user and continue
  req.user = user;
  next();
});
