const Tesseract = require("tesseract.js");
const sharp = require("sharp");
const path = require("path");

class ImageService {
    async processImage(file) {
        try {
            // Convert to base64 for frontend preview
            const base64Image = file.buffer.toString("base64");
            const imageUrl = `data:${file.mimetype};base64,${base64Image}`;

            // Preprocess image with sharp
            const processedBuffer = await sharp(file.buffer)
                .resize({ width: 1500 })   // upscale for clarity
                .grayscale()              // black & white
                .normalize()              // adjust contrast
                .sharpen()                // sharpen edges
                .toBuffer();

            // Path to local tessdata folder
            const tessDataPath = path.resolve(__dirname, "../tessdata");

            // Run OCR (Hindi + English) using local traineddata
            const { data: { text } } = await Tesseract.recognize(
                processedBuffer,
                "eng+hin",
                {
                    langPath: tessDataPath,       // use local tessdata
                    tessedit_pageseg_mode: 6,     // assume block of text
                    logger: m => console.log(m)   // progress log
                }
            );

            console.log("Extracted Raw Text:\n", text);

            // --- Extract PII with Regex ---
            const dobMatch = text.match(/\b\d{2}\/\d{2}\/\d{4}\b/);
            const aadhaarMatch = text.match(/\b\d{4}\s\d{4}\s\d{4}\b/);

            // Extract name (line before DOB)
            let name = null;
            const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
            const dobIndex = lines.findIndex(l => dobMatch && l.includes(dobMatch[0]));
            if (dobIndex > 0) {
                name = lines[dobIndex - 1];
            }

            // Extract address (after "Address" or "पता")
            let address = null;
            const addressIndex = lines.findIndex(
                l => l.toLowerCase().includes("address") || l.includes("पता")
            );
            if (addressIndex >= 0) {
                address = lines.slice(addressIndex).join(" ");
            }

            const pii = {
                name: name || null,
                dob: dobMatch ? dobMatch[0] : null,
                aadhaar: aadhaarMatch ? aadhaarMatch[0] : null,
                address: address || null,
            };

            return {
                originalImage: imageUrl,
                maskedImage: imageUrl, // TODO: implement masking later
                detectedPII: pii,
                message: "Image processed successfully",
                extractedText: text
            };
        } catch (error) {
            console.error("Error in ImageService:", error);
            throw error;
        }
    }
}

module.exports = ImageService;
