class ImageService {
    async processImage(file) {
        try {            
            if (!file || !file.buffer) {
                throw new Error("Invalid file or missing buffer");
            }
            const base64Image = file.buffer.toString("base64");
            const imageUrl = `data:${file.mimetype};base64,${base64Image}`;
            return {
                originalImage: imageUrl,
                maskedImage: imageUrl, 
                message: "Image processed successfully - ready for frontend display"
            };

        } catch (error) {
            console.error(" Error in ImageService:", error);
            throw new Error(`Image processing failed: ${error.message}`);
        }
    }
}

module.exports = ImageService;