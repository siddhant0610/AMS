// middleware/auth.middleware.js
import jwt from "jsonwebtoken";
import { User } from "../modules/User.js";
import { ApiError } from "../utils/api.Error.js";
import { asyncHandler } from "../asyncHandler.js";

/**
 * ✅ Middleware: verifyJWT
 * 
 * Works with both:
 *  - Cookie-based JWT (req.cookies.accessToken)
 *  - Bearer token in Authorization header
 * 
 * Responsibilities:
 *  - Validates token
 *  - Checks user existence
 *  - Attaches sanitized user object to req.user
 *  - Throws ApiError(401) on failure
 */
export const verifyJWT = asyncHandler(async (req, res, next) => {
  try {
    // 1️⃣ Extract token from cookie or Authorization header
    let token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "").trim();

    if (!token) {
      throw new ApiError(401, "Unauthorized — No access token provided");
    }

    // 2️⃣ Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        throw new ApiError(401, "Access token expired — please reauthenticate");
      } else if (err.name === "JsonWebTokenError") {
        throw new ApiError(401, "Invalid access token");
      } else {
        throw new ApiError(401, "Failed to verify token");
      }
    }

    // 3️⃣ Fetch user from DB and ensure valid
    const user = await User.findById(decoded?.id || decoded?._id).select(
      "-password -refreshTokens"
    );

    if (!user) {
      throw new ApiError(401, "User not found — invalid or outdated token");
    }

    // 4️⃣ Attach user to request object for downstream access
    req.user = user;
    next();
  } catch (error) {
    console.error("❌ JWT Verification Failed:", error.message);
    next(new ApiError(401, error.message || "Authentication failed"));
  }
});
