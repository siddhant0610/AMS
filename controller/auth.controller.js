import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { User } from "../modules/User.js";
import { ApiError } from "../utils/api.Error.js";
import { ApiResponse } from "../utils/api.response.js";
import { asyncHandler } from "../asyncHandler.js";

/* ------------------------------------------
   🔐 Helper Function — Generate Tokens
------------------------------------------- */
const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { id: user._id, role: user.role, email: user.email },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" }
  );

  const refreshToken = jwt.sign(
    { id: user._id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }
  );

  return { accessToken, refreshToken };
};

/* ------------------------------------------
   1️⃣ Login Controller
------------------------------------------- */
export const loginUser = asyncHandler(async (req, res) => {
  const { email, password, role } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  const user = await User.findOne({ email, role });
  if (!user) {
    throw new ApiError(401, "Invalid credentials");
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid credentials");
  }

  const { accessToken, refreshToken } = generateTokens(user);
  user.refreshToken = refreshToken;
  await user.save();

  return res
    .status(200)
    .json(
      new ApiResponse(200, "Logged in", {
        accessToken,
        refreshToken,
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          name: user.name,
        },
      })
    );
});

/* ------------------------------------------
   2️⃣ Get Logged-in User
------------------------------------------- */
export const getMe = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user) throw new ApiError(401, "Invalid or expired token");

  return res
    .status(200)
    .json(
      new ApiResponse(200, "User fetched successfully", {
        id: user._id,
        email: user.email,
        role: user.role,
        name: user.name,
      })
    );
});

/* ------------------------------------------
   3️⃣ Refresh Access Token
------------------------------------------- */
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

    return res
      .status(200)
      .json(
        new ApiResponse(200, "Access token refreshed", {
          accessToken,
          refreshToken: newRefreshToken,
        })
      );
  } catch {
    throw new ApiError(403, "Invalid or expired refresh token");
  }
});

/* ------------------------------------------
   4️⃣ Logout Controller
------------------------------------------- */
export const logoutUser = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new ApiError(400, "Refresh token is required");

  const user = await User.findOne({ refreshToken });
  if (user) {
    user.refreshToken = null;
    await user.save();
  }

  return res
    .status(200)
    .json(new ApiResponse(200, "Logged out successfully"));
});
