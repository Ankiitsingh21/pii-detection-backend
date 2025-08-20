const express = require("express");
const { ImageController, HealthCheck, TestOCR, GetSupportedTypes } = require("../../controller/image-controller");

const router = express.Router();

// Main PII detection and masking endpoint
router.post('/image', ImageController);

// Health check endpoint
router.get('/health', HealthCheck);

// Test OCR functionality
router.get('/test-ocr', TestOCR);

// Get supported document types and PII fields
router.get('/supported-types', GetSupportedTypes);

// API documentation endpoint
router.get('/docs', (req, res) => {
    const apiDocs = {
        title: "PII Detection & Masking API",
        version: "1.0.0",
        description: "API for detecting and masking Personally Identifiable Information (PII) in government ID documents",
        baseUrl: "/api/v1",
        endpoints: {
            "POST /image": {
                description: "Upload and process an image for PII detection and masking",
                parameters: {
                    "image": {
                        type: "file",
                        required: true,
                        description: "Image file (JPEG, PNG, GIF, BMP, TIFF) or PDF, max 10MB"
                    }
                },
                response: {
                    "originalImage": "Base64 encoded original image",
                    "maskedImage": "Base64 encoded image with PII masked",
                    "detectedPII": "Object containing detected PII fields",
                    "extractedText": "Raw text extracted from image via OCR",
                    "processingInfo": "Metadata about processing (confidence, time, etc.)",
                    "privacySummary": "Summary of privacy-related information"
                },
                example: {
                    curl: `curl -X POST \\
  http://localhost:3000/api/v1/image \\
  -H "Content-Type: multipart/form-data" \\
  -F "image=@/path/to/your/id-card.jpg"`
                }
            },
            "GET /health": {
                description: "Check service health and capabilities",
                response: {
                    "status": "Service status (healthy/unhealthy)",
                    "capabilities": "List of available features",
                    "supportedDocuments": "Array of supported document types",
                    "supportedFormats": "Array of supported file formats"
                }
            },
            "GET /test-ocr": {
                description: "Test OCR functionality with a sample image",
                response: {
                    "text": "Extracted text from test image",
                    "confidence": "OCR confidence score",
                    "success": "Boolean indicating test success"
                }
            },
            "GET /supported-types": {
                description: "Get detailed information about supported document types and PII fields",
                response: {
                    "documentTypes": "Object describing each supported document type",
                    "piiFields": "Object describing each PII field that can be detected",
                    "processingCapabilities": "Technical capabilities and limitations",
                    "privacyFeatures": "Privacy and security features"
                }
            },
            "GET /docs": {
                description: "API documentation (this endpoint)",
                response: "Complete API documentation"
            }
        },
        usage: {
            "step1": "Check service health with GET /health",
            "step2": "Upload image with POST /image",
            "step3": "Receive original and masked images with detected PII",
            "step4": "Use masked image for privacy-safe display/storage"
        },
        supportedDocuments: [
            "Aadhaar Card (आधार कार्ड)",
            "PAN Card (स्थायी खाता संख्या)",
            "Driving License",
            "Other Government IDs"
        ],
        detectedPII: [
            "Names (English & Hindi)",
            "Aadhaar Numbers (12 digits)",
            "PAN Numbers (10 characters)", 
            "Dates of Birth",
            "Phone Numbers",
            "Email Addresses",
            "Addresses",
            "Father's Name",
            "Profile Photos (estimated regions)"
        ],
        privacyGuarantees: [
            "No images stored on server",
            "Processing done in memory only",
            "No extracted data retained",
            "Secure PII masking with overlays",
            "Real-time processing and response"
        ],
        technicalDetails: {
            "ocrEngine": "Tesseract.js with English + Hindi support",
            "imageProcessing": "Sharp.js for preprocessing and masking",
            "patternMatching": "Custom regex patterns for Indian documents",
            "maskingMethod": "Black overlay with blur for detected PII regions",
            "coordinateDetection": "Word-level coordinate extraction from OCR"
        }
    };

    res.json({
        success: true,
        documentation: apiDocs,
        timestamp: new Date().toISOString()
    });
});

// Error handling middleware for this router
router.use((error, req, res, next) => {
    console.error('Route error:', error);
    
    if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            success: false,
            message: "File too large. Maximum size allowed is 10MB.",
            errorType: "FILE_SIZE_LIMIT",
            maxSize: "10MB"
        });
    }
    
    if (error.message.includes('Only image files')) {
        return res.status(400).json({
            success: false,
            message: "Invalid file type. Only image files and PDFs are allowed.",
            errorType: "INVALID_FILE_TYPE",
            supportedTypes: ["JPEG", "PNG", "GIF", "BMP", "TIFF", "PDF"]
        });
    }
    
    res.status(500).json({
        success: false,
        message: "Internal server error",
        errorType: "INTERNAL_ERROR",
        timestamp: new Date().toISOString()
    });
});

module.exports = router;