import fs from "fs";
import axios from "axios";
import sharp from "sharp";
import FormData from "form-data";

// ===============================
// CONFIGURATION
// ===============================
const FACE_DETECTION_API = process.env.FACE_DETECTION_API;
const FACE_RECOGNITION_API = process.env.FACE_RECOGNITION_API;
const HUGGINGFACE_TOKEN = process.env.HUGGINGFACE_TOKEN;

const API_TIMEOUT = parseInt(process.env.API_TIMEOUT) || 60000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // base delay for backoff
const DELAY_BETWEEN_IMAGES = 2000; // delay between requests in ms

// ===============================
// UTILITIES
// ===============================
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const retryWithBackoff = async (fn, retries = MAX_RETRIES) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      const delay = RETRY_DELAY * Math.pow(2, i);
      console.log(`⏳ Retry attempt ${i + 1}/${retries} after ${delay}ms`);
      await sleep(delay);
    }
  }
};

const resizeImage = async (imagePath) => {
  const resizedPath = imagePath.replace(/(\.\w+)$/, "_resized$1");
  await sharp(imagePath).resize(1280, 1280, { fit: "cover" }).toFile(resizedPath);
  return resizedPath;
};

// ===============================
// FACE DETECTION
// ===============================
export const detectFace = async (imagePath) => {
  try {
    if (!fs.existsSync(imagePath)) {
      return { success: false, faceDetected: false, error: "Image not found" };
    }

    const resizedPath = await resizeImage(imagePath);
    const formData = new FormData();
    formData.append("file", fs.createReadStream(resizedPath));

    const headers = formData.getHeaders();
    if (HUGGINGFACE_TOKEN)
      headers["Authorization"] = `Bearer ${HUGGINGFACE_TOKEN}`;

    const response = await retryWithBackoff(() =>
      axios.post(`${FACE_DETECTION_API}/detect`, formData, {
        headers,
        timeout: API_TIMEOUT,
      })
    );

    const data = response.data;
    fs.unlinkSync(resizedPath);

    if (!data.detections?.length) {
      return { success: true, faceDetected: false, detections: [] };
    }

    return {
      success: true,
      faceDetected: true,
      detections: data.detections,
      faceCount: data.count || data.detections.length,
    };
  } catch (error) {
    return {
      success: false,
      faceDetected: false,
      error: error.response?.data?.message || error.message,
    };
  }
};

// ===============================
// FACE RECOGNITION
// ===============================
export const recognizeFace = async (imagePath, options = {}) => {
  try {
    const detection = await detectFace(imagePath);
    if (!detection.success || !detection.faceDetected) {
      return { success: false, error: "No faces detected" };
    }

    const formData = new FormData();
    formData.append("file", fs.createReadStream(imagePath));
    formData.append("detections", JSON.stringify(detection.detections));

    const headers = formData.getHeaders();
    if (HUGGINGFACE_TOKEN)
      headers["Authorization"] = `Bearer ${HUGGINGFACE_TOKEN}`;

    const response = await retryWithBackoff(() =>
      axios.post(`${FACE_RECOGNITION_API}/recognize`, formData, {
        headers,
        timeout: API_TIMEOUT,
      })
    );

    const data = response.data;
    const results = data.results || [];

    if (!results.length) return { success: false, error: "No recognition results" };

    const matches = results
      .filter((r) => r.matched)
      .map((r) => ({
        studentId: r.name,
        confidence: r.confidence,
        bbox: r.bbox,
      }));

    return { success: true, matches, summary: data.summary };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ===============================
// BATCH FACE RECOGNITION (SEQUENTIAL)
// ===============================
export const processFaceBatch = async (imagePaths = [], sectionId) => {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    return { success: false, message: "No images provided" };
  }

  const results = [];
  console.log(`📸 Processing ${imagePaths.length} images sequentially...`);

  for (let i = 0; i < imagePaths.length; i++) {
    const imagePath = imagePaths[i];
    console.log(`🟩 [${i + 1}/${imagePaths.length}] ${path.basename(imagePath)}`);

    try {
      const recognition = await recognizeFace(imagePath, { sectionId });
      results.push({
        file: path.basename(imagePath),
        success: recognition.success,
        matches: recognition.matches || [],
      });
    } catch (err) {
      results.push({
        file: path.basename(imagePath),
        success: false,
        error: err.message,
      });
    }

    // Delay between API calls to prevent model overload
    if (i < imagePaths.length - 1) {
      console.log(`⏳ Waiting ${DELAY_BETWEEN_IMAGES / 1000}s before next image...`);
      await sleep(DELAY_BETWEEN_IMAGES);
    }
  }

  return { success: true, totalProcessed: results.length, results };
};
