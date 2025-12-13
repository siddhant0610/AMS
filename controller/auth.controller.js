import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { User } from "../modules/User.js";
import { ApiError } from "../utils/api.Error.js";
import { ApiResponse } from "../utils/api.response.js";
import { asyncHandler } from "../asyncHandler.js";

export const addUser=asyncHandler(async (req,res)=>{
  const {email,password}=req.body;
  if(!email || !password){
    throw new ApiError(400,"Email and password are required");
  }
  const existingUser=await User.findOne({email});
  if(existingUser){
    throw new ApiError(409,"User with this email already exists");
  }
  const hashedPassword=await bcrypt.hash(password,10);
  const user=await User.create({
    email,
    password:hashedPassword,
    role:User.role
  });
  res.status(201).json(new ApiResponse(201,"User created successfully",{id:user._id,email:user.email}));
})


/* ------------------------------------------------------------------
   🔐 Helper — Generate Single Token (Session-like)
------------------------------------------------------------------- */
const generateToken = (user) => {
  // Only one token. Give it a longer lifespan (e.g., 1 day) to act as a session.
  return jwt.sign(
    { id: user._id, email: user.email },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "1d" } 
  );
};

/* ------------------------------------------------------------------
   1️⃣ LOGIN USER
------------------------------------------------------------------- */
export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  const user = await User.findOne({ email });
  if (!user) throw new ApiError(401, "Invalid User");

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) throw new ApiError(401, "Invalid credentials");

  // Generate the single token
  const token = generateToken(user);

  // Cookie Options
  const options = {
    httpOnly: true, // Prevents client-side JS from reading the cookie (Security)
    secure: true,   // Ensure this is true in production (HTTPS)
    sameSite: "strict",
    maxAge: 7*24 * 60 * 60 * 1000 // 7 days in milliseconds (Match token expiry)
  };
user.refreshTokens = token; 
  await user.save({ validateBeforeSave: false });
  res
    .status(200)
    .cookie("token", token, options) // Save token in cookie
    .json(
      new ApiResponse(200, "Logged in successfully", {
        token, // Optional: send in JSON if you also want to use it in headers
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          refreshTokens: user.token
        },
      })
    );
});

/* ------------------------------------------------------------------
   2️⃣ LOGOUT USER
------------------------------------------------------------------- */
export const logoutUser = asyncHandler(async (req, res) => {
  // In a single-token JWT system, we just remove the cookie.
  // We don't need to touch the DB unless you are maintaining a "blacklist" of revoked tokens.
  
  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "strict"
  };

  return res
    .status(200)
    .clearCookie("token", options) // Clear the specific cookie
    .json(new ApiResponse(200, "Logged out successfully"));
});

/* ------------------------------------------------------------------
   3️⃣ GET LOGGED-IN USER INFO
------------------------------------------------------------------- */
export const getMe = asyncHandler(async (req, res) => {
    // req.user is already attached by your middleware
    return res.status(200).json(
        new ApiResponse(200, "User fetched successfully", req.user)
    );
});