import fs from "fs";
import path from "path";
import axios from "axios";
import archiver from "archiver";
import AdmZip from "adm-zip";
import FormData from "form-data";
import sharp from "sharp"; // Used for resizing

// ===============================
// CONFIGURATION
// ===============================
const PREDICT_API_URL = "https://adiml1-complete-attendance.hf.space";
const HUGGINGFACE_TOKEN = process.env.HUGGINGFACE_TOKEN;

// ⬇️ MODIFIED THIS LINE ⬇️
const API_TIMEOUT = parseInt(process.env.API_TIMEOUT) || 300000; // Increased to 5 minutes (300,000ms)

// ===============================
// UTILITIES
// ===============================

/**
 * Forcefully resizes an image to 1280x1280, ignoring aspect ratio.
 * Saves to a temporary file.
 * @param {string} imagePath - Path to the original image.
 * @returns {Promise<string>} Path to the resized temporary file.
 */
const resizeImage = async (imagePath) => {
  // Create a unique temp path for the resized file
  const resizedPath = path.join(
    path.dirname(imagePath),
    `${path.basename(
      imagePath,
      path.extname(imagePath)
    )}_resized_${Date.now()}${path.extname(imagePath)}`
  );

  await sharp(imagePath)
    .resize(1280, 1280, {
      fit: "fill", // Forcefully stretches/squashes image to 1280x1280
    })
    .toFile(resizedPath);

  return resizedPath;
};

/**
 * Resizes, then zips, an array of file paths into a single buffer.
 * Cleans up temporary resized files after zipping.
 * @param {string[]} imagePaths - Array of full file paths to zip.
 * @returns {Promise<Buffer>} A promise that resolves with the zip buffer.
 */
const zipImagePaths = (imagePaths) => {
  return new Promise((resolve, reject) => {
    // Self-invoking async function inside promise constructor
    (async () => {
      const archive = archiver("zip", { zlib: { level: 9 } });
      const chunks = [];
      const tempResizedPaths = []; // Keep track of temp files for cleanup

      archive.on("data", (d) => chunks.push(d));
      archive.on("error", reject);

      // Set up cleanup logic for when zipping is complete
      archive.on("finish", () => {
        // Clean up temp files *after* zipping is finished
        for (const tempPath of tempResizedPaths) {
          fs.unlink(tempPath, (err) => {
            if (err)
              console.error(`Failed to delete temp file: ${tempPath}`, err);
          });
        }
        resolve(Buffer.concat(chunks));
      });

      // Resize images *before* adding to archive
      for (const imagePath of imagePaths) {
        if (fs.existsSync(imagePath)) {
          try {
            const resizedPath = await resizeImage(imagePath); // Create resized file
            tempResizedPaths.push(resizedPath); // Add to cleanup list

            // Add resized file to zip, using its *original* basename
            archive.file(resizedPath, { name: path.basename(imagePath) });
          } catch (err) {
            console.error(`Failed to resize image ${imagePath}:`, err);
            // Reject the promise if resizing fails
            reject(
              new Error(`Failed to resize image ${imagePath}: ${err.message}`)
            );
            return;
          }
        }
      }
      archive.finalize();
    })(); // End of self-invoking async function
  });
};

// ===============================
// BATCH FACE RECOGNITION (ZIP-BASED)
// ===============================

/**
 * Processes a batch of images by resizing, zipping, sending to /predict,
 * and parsing the results zip.
 *
 * @param {string[]} imagePaths - Array of file paths to process.
 * @param {string} sectionId - The section ID (passed for context).
 * @returns {object} The processing results.
 */
export const processFaceBatch = async (imagePaths = [], sectionId) => {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    return { success: false, message: "No images provided" };
  }

  console.log(
    `📸 Resizing and zipping ${imagePaths.length} images for batch processing...`
  );

  try {
    // 1. Resize and zip all images into a buffer
    const testZipBuffer = await zipImagePaths(imagePaths);

    // 2. Create Form Data and append the zip
    const form = new FormData();
    form.append("test_zip", testZipBuffer, {
      filename: "test_images.zip",
      contentType: "application/zip",
    });

    const headers = form.getHeaders();
    if (HUGGINGFACE_TOKEN) {
      headers["Authorization"] = `Bearer ${HUGGINGFACE_TOKEN}`;
    }

    // 3. Post to the /predict endpoint
    console.log("🚀 Sending batch to /predict endpoint... (Timeout: 5 minutes)");
    const res = await axios.post(`${PREDICT_API_URL}/predict`, form, {
      headers,
      timeout: API_TIMEOUT, // Uses the new 5-minute timeout
    });

    const predictData = res.data;
    if (!predictData.results_zip) {
      throw new Error("API response missing 'results_zip'");
    }

    console.log(
      `✅ Initial response received. Images: ${predictData.total_images}, Students: ${predictData.unique_students}`
    );

    // 4. Download the results zip
    const zipUrl = PREDICT_API_URL + predictData.results_zip;
    //console.log(`⬇️ Downloading results from ${zipUrl}`);

    const zipRes = await axios.get(zipUrl, {
      responseType: "arraybuffer",
      timeout: API_TIMEOUT, // Uses the new 5-minute timeout
    });

    const zipBuffer = Buffer.from(zipRes.data);

    // 5. Unzip and find the results.json
    const zip = new AdmZip(zipBuffer);
    const resultsEntry = zip.getEntry("results.json");

    // if (!resultsEntry) {
    //   throw new Error("Results zip did not contain 'results.json'");
    // }

    const resultsJson = JSON.parse(resultsEntry.getData().toString("utf8"));

    // 6. Return the data in the format your controller expects
    return resultsJson;
  } catch (error) {
    console.error("❌ Error in new processFaceBatch:", error.message);
    if (error.response) {
      console.error("API Error Data:", error.response.data);
    }
    return { success: false, message: error.message, results: [] };
  }
};