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
        // Cleanup resized temp files
        for (const tempPath of tempResizedPaths) {
          fs.unlink(tempPath, (err) => {
             if(err) console.error(`⚠️ Failed to delete resized temp: ${tempPath}`);
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
// 🧠 MAIN PROCESS (Updated for 'attendance' Key)
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
    
    // =========================================================
    // 🕵️ DETECT RESPONSE TYPE
    // =========================================================
    
    // ✅ SCENARIO A: New Format (Key is 'attendance')
    if (predictData.attendance) {
        console.log(`✅ Received 'attendance' list with ${predictData.attendance.length} students.`);
        return { success: true, results: predictData.attendance };
    }

    // ✅ SCENARIO B: Standard JSON (Key is 'results' or direct array)
    if (predictData.results || Array.isArray(predictData)) {
        console.log("✅ Received Direct JSON Results.");
        const finalResults = predictData.results || predictData;
        return { success: true, results: finalResults };
    }

    // ✅ SCENARIO C: Zip File (Legacy/Fallback)
    if (predictData.results_zip) {
        console.log(`✅ Received ZIP. Fetching from: ${predictData.results_zip}`);
        
        const zipUrl = PREDICT_API_URL + predictData.results_zip;
        const zipRes = await axios.get(zipUrl, {
            responseType: "arraybuffer",
            timeout: API_TIMEOUT,
        });

        const zip = new AdmZip(Buffer.from(zipRes.data));
        const zipEntries = zip.getEntries();
        let resultsJson = null;

        zipEntries.forEach((entry) => {
            if (entry.entryName === "results.json") {
                try {
                    const jsonText = entry.getData().toString("utf8");
                    resultsJson = JSON.parse(jsonText);
                } catch (e) {
                    console.warn("⚠️ Could not parse results.json.");
                }
            }
        });

        if (!resultsJson) throw new Error("AI failed: 'results.json' not found in ZIP.");
        
        return { 
            success: true, 
            results: resultsJson.results || resultsJson 
        };
    }

    // ❌ SCENARIO D: Unknown Format
    console.error("❌ Unexpected API Response:", JSON.stringify(predictData, null, 2));
    throw new Error("AI Service Response format not recognized (Missing 'attendance', 'results', or 'results_zip')");

  } catch (error) {
    console.error("❌ Error in processFaceBatch:", error.message);
    throw error; 
  }
};