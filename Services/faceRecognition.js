import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import sharp from 'sharp';
import { Student } from '../modules/Student.js';
import { Section } from '../modules/Section.js';

// Configuration - Your Hugging Face API URLs (confirmed working)
const FACE_DETECTION_API = process.env.FACE_DETECTION_API;
const FACE_RECOGNITION_API = process.env.FACE_RECOGNITION_API;
const REPORT_GENERATION_API = process.env.REPORT_GENERATION_API;
const HUGGINGFACE_TOKEN = process.env.HUGGINGFACE_TOKEN; // Optional for public spaces
const API_TIMEOUT = parseInt(process.env.API_TIMEOUT) || 30000;
const MAX_RETRIES = 5;
const RETRY_DELAY = 1000;

// Validate configuration
// if (!HUGGINGFACE_TOKEN) {
//     console.warn('HUGGINGFACE_TOKEN optional for public spaces, but add for private.');
// }

/**
 * Retry logic with exponential backoff
 */
const retryWithBackoff = async (fn, retries = MAX_RETRIES) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === retries - 1) throw error;
            const delay = RETRY_DELAY * Math.pow(2, i);
            console.log(`Retry attempt ${i + 1}/${retries} after ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

/**
 * Detect faces - Matches API exactly
 */
export const detectFace = async (imagePath) => {
    try {
        if (!fs.existsSync(imagePath)) {
            return { success: false, faceDetected: false, error: 'Image file not found' };
        }
        
    const resizedPath = imagePath.replace(/(\.\w+)$/, "_resized$1");

    await sharp(imagePath).resize(1280, 1280).toFile(resizedPath);
        const formData = new FormData();
        formData.append('file', fs.createReadStream(resizedPath));

        const headers = { ...formData.getHeaders() };
        if (HUGGINGFACE_TOKEN) headers['Authorization'] = `Bearer ${HUGGINGFACE_TOKEN}`;

        const response = await retryWithBackoff(async () => {
            return await axios.post(`${FACE_DETECTION_API}/detect`, formData, { headers, timeout: API_TIMEOUT });
        });

        const data = response.data;
        const detections = data.detections || []; // API uses 'detections'

        if (!detections || detections.length === 0) {
            return { success: true, faceDetected: false, detections: [] };
        }

        return {
            success: true,
            faceDetected: true,
            detections, // Keep as-is for recognition
            faceCount: data.count || detections.length
        };

    } catch (error) {
        console.error('Face detection error:', error.message);
        if (error.response) {
            return { success: false, faceDetected: false, error: error.response.data?.message || 'API error' };
        }
        if (error.code === 'ECONNABORTED') {
            return { success: false, faceDetected: false, error: 'Timeout' };
        }
        return { success: false, faceDetected: false, error: error.message };
    }
};

/**
 * Recognize faces - Updated to send detections (bboxes) JSON, not embeddings
 * Assumes templates pre-loaded in .npz
 */
export const recognizeFace = async (imagePath, options = {}) => {
    try {
        if (!fs.existsSync(imagePath)) {
            return { success: false, error: 'Image file not found' };
        }

        // Step 1: Detect faces first (required for bboxes)
        const detection = await detectFace(imagePath);
        if (!detection.success || !detection.faceDetected) {
            return { success: false, error: 'No faces detected' };
        }

        const detectionsJson = JSON.stringify(detection.detections); // API expects this

        const formData = new FormData();
        formData.append('file', fs.createReadStream(imagePath));
        formData.append('detections', detectionsJson); // Key change: detections, not known_embeddings

        const headers = { ...formData.getHeaders() };
        if (HUGGINGFACE_TOKEN) headers['Authorization'] = `Bearer ${HUGGINGFACE_TOKEN}`;

        const response = await retryWithBackoff(async () => {
            return await axios.post(`${FACE_RECOGNITION_API}/recognize`, formData, { headers, timeout: API_TIMEOUT });
        });

        const data = response.data;
        const results = data.results || [];

        if (!data || results.length === 0) {
            return { success: false, error: 'No recognition results' };
        }

        // Flatten for single-match (or return all)
        const matches = results.filter(r => r.matched).map(r => ({
            studentId: r.name, // API uses 'name' as student_id
            confidence: r.confidence,
            matchedWith: { regNo: r.reg_no || 'N/A', name: r.student_name || r.name },
            bbox: r.bbox,
            tier: r.tier_used,
            quality: r.quality_score
        }));

        return {
            success: true,
            matches, // Array of matches (one per face)
            summary: data.summary || { recognition_rate: matches.length / results.length }
        };

    } catch (error) {
        console.error('Face recognition error:', error.message);
        if (error.response) {
            return { success: false, error: error.response.data?.message || 'API error' };
        }
        return { success: false, error: error.message };
    }
};

/**
 * Enroll student face - Generate embedding locally, build .npz offline, sync to API
 * (API has no /generate-embedding; use local ArcFace or script)
 */
export const enrollStudentFace = async (imagePath, studentId) => {
    try {
        if (!fs.existsSync(imagePath)) {
            return { success: false, error: 'Image file not found' };
        }

        // Detect first
        const detection = await detectFace(imagePath);
        if (!detection.success || !detection.faceDetected || detection.faceCount !== 1) {
            return { success: false, error: 'Single clear face required for enrollment' };
        }

        // TODO: Extract embedding locally (use insightface JS port or send to temp endpoint)
        // For now, mock - implement with node-insightface or external call
        const embedding = [0.1, 0.2]; // Placeholder: Run ArcFace locally

        // Save to Mongo
        await Student.findByIdAndUpdate(studentId, {
            faceEmbedding: embedding,
            faceRegisteredAt: new Date()
        });

        // Build .npz (offline script needed) + sync
        // await syncEnrollmentDatabase(); // Call your .npz builder + POST /sync_database

        return { success: true, embedding };
    } catch (error) {
        console.error('Enrollment error:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * Generate report - Updated to send recognition_results JSON, Excel only
 */
export const generateAttendanceReport = async (recognitionResults, options = {}) => {
    try {
        const { format = 'excel' } = options; // Ignore others - API doesn't use section_id/dates

        if (format !== 'excel') {
            return { success: false, error: 'Only Excel supported; update API for CSV/PDF' };
        }

        const formData = new FormData();
        formData.append('recognition_results', JSON.stringify(recognitionResults)); // Key change

        const headers = { ...formData.getHeaders() };
        if (HUGGINGFACE_TOKEN) headers['Authorization'] = `Bearer ${HUGGINGFACE_TOKEN}`;

        const response = await retryWithBackoff(async () => {
            return await axios.post(`${REPORT_GENERATION_API}/generate_report`, formData, {
                headers,
                timeout: 60000,
                responseType: 'arraybuffer' // For binary Excel
            });
        });

        return {
            success: true,
            reportData: response.data, // Buffer for .xlsx
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };

    } catch (error) {
        console.error('Report error:', error.message);
        if (error.response) {
            return { success: false, error: error.response.data?.message || 'API error' };
        }
        return { success: false, error: error.message };
    }
};

/**
 * Mock quality (add /verify-quality to detection API)
 */
export const verifyImageQuality = async (imagePath) => {
    // Mock - Use recognition metrics or add endpoint
    const mock = { isBlurry: false, brightness: 120, faceSize: 100, isAcceptable: true };
    return { success: true, quality: mock };
};

/**
 * Health check - Matches exactly
 */
export const checkServiceHealth = async () => {
    try {
        const healthChecks = await Promise.allSettled([
            axios.get(`${FACE_DETECTION_API}/health`, { timeout: 5000 }),
            axios.get(`${FACE_RECOGNITION_API}/health`, { timeout: 5000 }),
            axios.get(`${REPORT_GENERATION_API}/health`, { timeout: 5000 })
        ]);

        return {
            success: true,
            services: {
                faceDetection: { status: healthChecks[0].status === 'fulfilled' ? 'healthy' : 'unhealthy', data: healthChecks[0].value?.data },
                faceRecognition: { status: healthChecks[1].status === 'fulfilled' ? 'healthy' : 'unhealthy', data: healthChecks[1].value?.data },
                reportGeneration: { status: healthChecks[2].status === 'fulfilled' ? 'healthy' : 'unhealthy', data: healthChecks[2].value?.data }
            }
        };
    } catch (error) {
        return { success: false, error: 'Health check failed' };
    }
};

export default {
    detectFace,
    recognizeFace,
    enrollStudentFace, // New: For enrollment
    generateAttendanceReport,
    verifyImageQuality,
    checkServiceHealth
};