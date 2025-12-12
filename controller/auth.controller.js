import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { User } from "../modules/User.js";
import { ApiError } from "../utils/api.Error.js";
import { ApiResponse } from "../utils/api.response.js";
import { asyncHandler } from "../asyncHandler.js";

/* ------------------------------------------------------------------
   🔐 Helper — Generate Access & Refresh Tokens
------------------------------------------------------------------- */
const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { id: user._id, email: user.email },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" } // short-lived
  );

  const refreshToken = jwt.sign(
    { id: user._id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" } // longer-lived
  );

  return { accessToken, refreshToken };
};

/* ------------------------------------------------------------------
   1️⃣ LOGIN USER
------------------------------------------------------------------- */
export const loginUser = asyncHandler(async (req, res) => {
  const { email, password} = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  const user = await User.findOne({ email });
  if (!user) throw new ApiError(401, "Invalid credentials");

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) throw new ApiError(401, "Invalid credentials");

  const { accessToken, refreshToken } = generateTokens(user);

  user.refreshToken = refreshToken;
  await user.save();

  // Optionally, set cookies (comment out if using JSON only)
  // res.cookie("accessToken", accessToken, { httpOnly: true, secure: true, sameSite: "strict" });
  // res.cookie("refreshToken", refreshToken, { httpOnly: true, secure: true, sameSite: "strict" });

  return res
    .status(200)
    .json(
      new ApiResponse(200, "Logged in successfully", {
        accessToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role:user.role
        },
      })
    );
});

/* ------------------------------------------------------------------
   2️⃣ GET LOGGED-IN USER INFO (/auth/me)
------------------------------------------------------------------- */
export const getMe = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) throw new ApiError(401, "Invalid or expired token");

  return res
    .status(200)
    .json(
      new ApiResponse(200, "User fetched successfully", {
        id: user._id,
        name: user.name,
        email: user.email,
        role:user.role
      })
    );
});

/* ------------------------------------------------------------------
   3️⃣ REFRESH ACCESS TOKEN (/auth/refresh)
------------------------------------------------------------------- */
export const refreshAccessToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) throw new ApiError(401, "Refresh token is required");

  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || user.refreshToken !== refreshToken) {
      throw new ApiError(403, "Invalid or expired refresh token");
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
    user.refreshToken = newRefreshToken;
    await user.save();

    // Optional: update cookies
    // res.cookie("accessToken", accessToken, { httpOnly: true, secure: true, sameSite: "strict" });
    // res.cookie("refreshToken", newRefreshToken, { httpOnly: true, secure: true, sameSite: "strict" });

    return res
      .status(200)
      .json(
        new ApiResponse(200, "Access token refreshed", {
          accessToken,
          refreshToken: newRefreshToken,
        })
      );
  } catch (error) {
    throw new ApiError(403, "Invalid or expired refresh token");
  }
});

/* ------------------------------------------------------------------
   4️⃣ LOGOUT USER (/auth/logout)
------------------------------------------------------------------- */
export const logoutUser = asyncHandler(async (req, res) => {
  const { refreshToken, } = req.body;

  if (!refreshToken) throw new ApiError(400, "Refresh token is required");

  const user = await User.findOne({ refreshToken });

  if (user) {
    user.accessToken=null;
    user.refreshToken = null;
    await user.save();
  }

  // Optionally clear cookies
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");

  return res
    .status(200)
    .json(new ApiResponse(200, "Logged out successfully"));
});

/* ------------------------------------------------------------------
   5️⃣ PROTECTED TEST ENDPOINT (/secure/ping)
------------------------------------------------------------------- */
export const securePing = asyncHandler(async (req, res) => {
  return res.status(200).json(
    new ApiResponse(200, "pong", {
      message: `pong for ${req.user?.email || req.user?.id}`,
    })
  );
});
