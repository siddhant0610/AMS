import fs from "fs";
import path from "path";
import axios from "axios";
import archiver from "archiver";
import AdmZip from "adm-zip";
import FormData from "form-data";
import sharp from "sharp"; 

// ===============================
// CONFIGURATION
// ===============================
const PREDICT_API_URL = "https://adiml1-complete-attendance.hf.space";
const HUGGINGFACE_TOKEN = process.env.HUGGINGFACE_TOKEN;
const API_TIMEOUT = parseInt(process.env.API_TIMEOUT) || 300000; // 5 Minutes

// ===============================
// UTILITIES (Resize & Zip)
// ===============================
// ⚠️ KEEP THESE FULL FUNCTIONS! Do not replace them with placeholders.
const resizeImage = async (imagePath) => {
  const resizedPath = path.join(
    path.dirname(imagePath),
    `${path.basename(imagePath, path.extname(imagePath))}_resized_${Date.now()}${path.extname(imagePath)}`
  );

  await sharp(imagePath)
    .resize(1280, 1280, { fit: "fill" })
    .toFile(resizedPath);

  return resizedPath;
};

const zipImagePaths = (imagePaths) => {
  return new Promise((resolve, reject) => {
    (async () => {
      const archive = archiver("zip", { zlib: { level: 9 } });
      const chunks = [];
      const tempResizedPaths = [];

      archive.on("data", (d) => chunks.push(d));
      archive.on("error", reject);

      archive.on("finish", () => {
        for (const tempPath of tempResizedPaths) {
          fs.unlink(tempPath, (err) => {
            if (err) console.error(`Failed to delete temp file: ${tempPath}`, err);
          });
        }
        resolve(Buffer.concat(chunks));
      });

      for (const imagePath of imagePaths) {
        if (fs.existsSync(imagePath)) {
          try {
            const resizedPath = await resizeImage(imagePath);
            tempResizedPaths.push(resizedPath);
            archive.file(resizedPath, { name: path.basename(imagePath) });
          } catch (err) {
            reject(new Error(`Failed to resize image ${imagePath}: ${err.message}`));
            return;
          }
        }
      }
      archive.finalize();
    })();
  });
};

// ===============================
// 🧠 MAIN PROCESS
// ===============================
export const processFaceBatch = async (imagePaths = [], sectionId) => {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    return { success: false, message: "No images provided" };
  }

  console.log(`📸 Resizing and zipping ${imagePaths.length} images...`);

  try {
    // 1. Prepare Zip
    const testZipBuffer = await zipImagePaths(imagePaths);
    const form = new FormData();
    form.append("test_zip", testZipBuffer, {
      filename: "test_images.zip",
      contentType: "application/zip",
    });

    const headers = form.getHeaders();
    if (HUGGINGFACE_TOKEN) headers["Authorization"] = `Bearer ${HUGGINGFACE_TOKEN}`;

    // 2. Send to AI Service
    console.log("🚀 Sending to AI Service...");
    const res = await axios.post(`${PREDICT_API_URL}/predict`, form, {
      headers,
      timeout: API_TIMEOUT,
    });

    const predictData = res.data;
    if (!predictData.results_zip) throw new Error("API response missing 'results_zip'");

    console.log(`✅ AI Processed. Fetching results from: ${predictData.results_zip}`);

    // 3. Download the Result Zip
    const zipUrl = PREDICT_API_URL + predictData.results_zip;
    const zipRes = await axios.get(zipUrl, {
      responseType: "arraybuffer",
      timeout: API_TIMEOUT,
    });

    // 4. Extract Data (JSON + EXCEL)
    const zip = new AdmZip(Buffer.from(zipRes.data));
    const zipEntries = zip.getEntries();

    let resultsJson = null;
    let excelBuffer = null;

    zipEntries.forEach((entry) => {
      // A. Extract JSON Results
      if (entry.entryName === "results.json") {
        const jsonText = entry.getData().toString("utf8");
        resultsJson = JSON.parse(jsonText);
      }

      // B. Extract Excel File
     if (
        entry.entryName.includes("consolidated") && 
        entry.entryName.endsWith(".xlsx")
      ) {
        console.log(`🎯 FOUND MASTER REPORT: ${entry.entryName}`);
        excelBuffer = entry.getData(); 
      }
    });

    if (!resultsJson) throw new Error("Results zip missing 'results.json'");

    // 5. Structure the return (The "Safe" Logic)
    // Checks if resultsJson is { results: [...] } OR just [...]
    const finalResults = resultsJson.results || resultsJson; 

    return {
      success: true,
      results: finalResults, 
      excelBuffer: excelBuffer 
    };

  } catch (error) {
    console.error("❌ Error in processFaceBatch:", error.message);
    return { success: false, message: error.message, results: [] };
  }
};