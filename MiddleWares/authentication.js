import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { ApiError } from "../utils/api.Error.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * Middleware to verify JWT access token.
 * Works for:
 *  - Cookies (req.cookies.accessToken)
 *  - Authorization header (Bearer <token>)
 * Throws:
 *  - 401 Unauthorized on invalid, expired, or missing token
 *  - Attaches `req.user` with sanitized user object
 */
export const verifyJWT = asyncHandler(async (req, res, next) => {
  try {
    // 1️⃣ Extract token from either cookie or header
    let token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "").trim();

    if (!token) {
      throw new ApiError(401, "Unauthorized — No token provided");
    }

    // 2️⃣ Verify token signature and expiry
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        throw new ApiError(401, "Access token expired — please log in again");
      } else if (err.name === "JsonWebTokenError") {
        throw new ApiError(401, "Invalid access token");
      } else {
        throw new ApiError(401, "Authentication failed");
      }
    }

    // 3️⃣ Fetch user from database
    const user = await User.findById(decoded?._id).select(
      "-password -refreshToken"
    );

    if (!user) {
      throw new ApiError(401, "User not found — invalid token");
    }

    // 4️⃣ Attach user to request for downstream routes
    req.user = user;
    next();
  } catch (error) {
    console.error("❌ JWT Verification Failed:", error.message);
    next(new ApiError(401, error?.message || "Invalid access token"));
  }
});
