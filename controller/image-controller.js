const multer = require('multer');
const ImageService = require("../services/image-service");

const imageService = new ImageService();

// Configure multer for memory storage
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

const ImageController = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                message: "No image file uploaded",
                success: false
            });
        }

        // Pass the file buffer to service
        const response = await imageService.processImage(req.file);
        
        return res.status(201).json({
            message: "Image processed",
            data: response,
            success: true
        });
    } catch (error) {
        console.log("Error in the controller layer", error);
        return res.status(500).json({
            message: "Failed to process image",
            error: error.message,
            success: false
        });
    }
}

module.exports = { 
    ImageController: [upload.single('image'), ImageController]
};