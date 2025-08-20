const multer = require("multer");
const ImageService = require("../services/image-service");

const imageService = new ImageService();

// Multer setup (memory storage + file filter)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only images and PDFs are allowed!"), false);
    }
  },
});

const ImageController = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Please upload an image or PDF.",
      });
    }

    const result = await imageService.processImage(req.file);

    return res.status(200).json({
      success: true,
      message: "Image processed successfully",
      data: {
        originalImage: result.originalImage,
        maskedImage: result.maskedImage || result.originalImage,
        detectedPII: result.detectedPII || {},
        extractedText: result.extractedText || "",
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to process image",
      error: err.message,
    });
  }
};

module.exports = {
  ImageController: [upload.single("image"), ImageController],
};
