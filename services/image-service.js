const Tesseract = require('tesseract.js');
const Jimp = require('jimp');

class ImageService {
    constructor() {
        // No initialization needed
    }

    async detectPII(text) {
        // Enhanced PII patterns for Indian documents
        const piiPatterns = {
            email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
            phone: /\b(?:\+?(\d{1,3}))?[-. (]*(\d{3})[-. )]*(\d{3})[-. ]*(\d{4})\b/g,
            creditCard: /\b(?:\d{4}[- ]?){3}\d{4}\b/g,
            ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
            pan: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/gi, // PAN card format
            aadhaar: /\b[0-9]{4}\s?[0-9]{4}\s?[0-9]{4}\b/g, // Aadhaar number format
            dob: /\b(0[1-9]|[12][0-9]|3[01])[\/\-](0[1-9]|1[012])[\/\-](19|20)\d{2}\b/g, // Date of birth
            // Name patterns (both English and Hindi)
            name: /\b([A-Z][a-z]+(\s[A-Z][a-z]+)+)|([\u0900-\u097F]+(\s[\u0900-\u097F]+)+)\b/gu,
            // Address patterns (Hindi and English)
            address: /([\u0900-\u097F]+(\s[\u0900-\u097F]+){3,})|([A-Za-z0-9\s,.-]{10,})/gu
        };

        const detectedPII = [];
        for (const [type, pattern] of Object.entries(piiPatterns)) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                detectedPII.push({
                    type,
                    value: match[0],
                    startIndex: match.index,
                    endIndex: match.index + match[0].length
                });
            }
        }
        return detectedPII;
    }

    async blurRegion(image, x, y, width, height, blurRadius) {
        // Ensure coordinates are within image bounds
        x = Math.max(0, x);
        y = Math.max(0, y);
        width = Math.min(width, image.bitmap.width - x);
        height = Math.min(height, image.bitmap.height - y);
        
        if (width <= 0 || height <= 0) return;
        
        // Extract the region to blur
        const region = image.clone().crop(x, y, width, height);
        
        // Apply blur to the region
        region.blur(blurRadius);
        
        // Composite the blurred region back onto the original image
        image.composite(region, x, y);
    }

    async blurPartialText(image, word, pii) {
        const { text, bbox } = word;
        const { value, type } = pii;
        
        // Calculate character width approximation
        const charWidth = (bbox.x1 - bbox.x0) / text.length;
        
        // Find the position of the PII within the word
        const piiStartInWord = text.indexOf(value);
        if (piiStartInWord === -1) return; // PII not found in this word
        
        // Calculate coordinates for partial blurring
        let blurStartX, blurWidth;
        
        if (type === 'aadhaar') {
            // For Aadhaar: blur first 8 digits, keep last 4
            const aadhaarDigits = value.replace(/\D/g, '');
            if (aadhaarDigits.length !== 12) return;
            
            // Calculate position of first 8 digits
            let digitCount = 0;
            let charCount = 0;
            for (let i = 0; i < value.length && digitCount < 8; i++) {
                if (/\d/.test(value[i])) {
                    digitCount++;
                }
                charCount++;
            }
            
            blurStartX = bbox.x0 + (piiStartInWord * charWidth);
            blurWidth = charCount * charWidth;
        } 
        else if (type === 'pan') {
            // For PAN: blur first 6 characters, keep last 4
            if (value.length !== 10) return;
            
            blurStartX = bbox.x0 + (piiStartInWord * charWidth);
            blurWidth = 6 * charWidth;
        }
        else if (type === 'dob') {
            // For DOB: blur day and month, keep year
            const dobParts = value.split(/[\/\-]/);
            if (dobParts.length !== 3) return;
            
            // Calculate positions for day and month
            const dayMonthLength = dobParts[0].length + dobParts[1].length + 1; // +1 for separator
            blurStartX = bbox.x0 + (piiStartInWord * charWidth);
            blurWidth = dayMonthLength * charWidth;
        }
        else {
            // For names, addresses, etc., blur the entire text
            blurStartX = bbox.x0;
            blurWidth = bbox.x1 - bbox.x0;
        }
        
        // Apply the blur
        await this.blurRegion(
            image,
            blurStartX,
            bbox.y0,
            blurWidth,
            bbox.y1 - bbox.y0,
            12
        );
    }

    async detectFacesSimple(image) {
        // Simple face detection using skin tone detection
        // This is a very basic approach and won't be as accurate as ML-based solutions
        const faces = [];
        const width = image.bitmap.width;
        const height = image.bitmap.height;
        
        // Scan the image for skin tone regions
        for (let y = 0; y < height; y += 10) { // Sample every 10 pixels for performance
            for (let x = 0; x < width; x += 10) {
                const pixelColor = Jimp.intToRGBA(image.getPixelColor(x, y));
                
                // Basic skin tone detection (adjust these values as needed)
                if (this.isSkinTone(pixelColor)) {
                    // Check surrounding area to confirm it's a face-like region
                    const faceSize = this.checkFaceRegion(image, x, y);
                    if (faceSize > 0) {
                        faces.push({
                            x: Math.max(0, x - faceSize/2),
                            y: Math.max(0, y - faceSize/2),
                            width: faceSize,
                            height: faceSize
                        });
                        
                        // Skip ahead to avoid detecting the same face multiple times
                        x += faceSize;
                        y += faceSize/10;
                    }
                }
            }
        }
        
        return faces;
    }

    isSkinTone(color) {
        // Basic skin tone detection based on RGB values
        const {r, g, b} = color;
        
        // Rule-based skin tone detection
        return (
            r > 120 && r < 240 &&
            g > 80 && g < 210 &&
            b > 70 && b < 190 &&
            r > g && r > b &&        // Red is dominant
            Math.abs(r - g) > 15 &&  // Red and green are sufficiently different
            Math.abs(r - g) < 80     // But not too different
        );
    }

    checkFaceRegion(image, x, y) {
        // Check if the region around (x,y) has characteristics of a face
        const sampleSize = 20;
        let skinPixels = 0;
        let totalPixels = 0;
        
        for (let dy = -sampleSize/2; dy < sampleSize/2; dy += 2) {
            for (let dx = -sampleSize/2; dx < sampleSize/2; dx += 2) {
                const nx = x + dx;
                const ny = y + dy;
                
                if (nx >= 0 && nx < image.bitmap.width && 
                    ny >= 0 && ny < image.bitmap.height) {
                    totalPixels++;
                    const pixelColor = Jimp.intToRGBA(image.getPixelColor(nx, ny));
                    if (this.isSkinTone(pixelColor)) {
                        skinPixels++;
                    }
                }
            }
        }
        
        // If enough pixels in the region are skin tone, consider it a face
        if (totalPixels > 0 && skinPixels / totalPixels > 0.6) {
            return sampleSize * 2; // Return estimated face size
        }
        
        return 0;
    }

    async processImage(file) {
        try {
            if (!file || !file.buffer) {
                throw new Error("Invalid file or missing buffer");
            }

            // Load image with Jimp (keep original colors)
            const image = await Jimp.read(file.buffer);

            // Get original image as base64
            const getBase64 = (img) => {
                return new Promise((resolve, reject) => {
                    img.getBuffer(Jimp.MIME_JPEG, (err, buffer) => {
                        if (err) reject(err);
                        resolve(buffer.toString('base64'));
                    });
                });
            };

            const originalBase64 = await getBase64(image);

            // 1. Simple face detection
            let faceDetections = [];
            try {
                faceDetections = await this.detectFacesSimple(image);
                console.log(`Detected ${faceDetections.length} faces`);
                
                // Blur detected faces
                for (const face of faceDetections) {
                    await this.blurRegion(
                        image, 
                        face.x, 
                        face.y, 
                        face.width, 
                        face.height, 
                        15
                    );
                }
            } catch (error) {
                console.error('Face detection error:', error);
            }

            // 2. Text detection and PII scanning
            let piiList = [];
            let words = [];
            
            try {
                // Use Tesseract with both English and Hindi
                const result = await Tesseract.recognize(file.buffer, 'eng+hin');
                
                const text = result.data.text;
                console.log('Extracted text:', text);
                
                // Detect PII in the text
                piiList = await this.detectPII(text);
                words = result.data.words || [];
                
                console.log(`Detected ${piiList.length} PII items:`, piiList);
                
                // Blur detected PII words
                for (const pii of piiList) {
                    // Find words that contain this PII
                    const matchingWords = words.filter(word => 
                        word.text && word.text.includes(pii.value)
                    );

                    for (const word of matchingWords) {
                        if (['aadhaar', 'pan', 'dob'].includes(pii.type)) {
                            // Partial blurring for Aadhaar, PAN, and DOB
                            await this.blurPartialText(image, word, pii);
                        } else {
                            // Full blurring for names, addresses, etc.
                            await this.blurRegion(
                                image,
                                word.bbox.x0,
                                word.bbox.y0,
                                word.bbox.x1 - word.bbox.x0,
                                word.bbox.y1 - word.bbox.y0,
                                12
                            );
                        }
                    }
                    
                    // If no words matched, try to find approximate matches
                    if (matchingWords.length === 0) {
                        console.log(`No exact match found for PII: ${pii.value}, trying approximate match`);
                        
                        // Look for words that contain parts of the PII
                        const partialMatches = words.filter(word => 
                            word.text && pii.value.includes(word.text)
                        );
                        
                        for (const word of partialMatches) {
                            await this.blurRegion(
                                image,
                                word.bbox.x0,
                                word.bbox.y0,
                                word.bbox.x1 - word.bbox.x0,
                                word.bbox.y1 - word.bbox.y0,
                                12
                            );
                        }
                    }
                }
            } catch (error) {
                console.error('OCR error:', error);
            }

            // Get processed image as base64
            const processedBase64 = await getBase64(image);
            const processedImageUrl = `data:image/jpeg;base64,${processedBase64}`;

            return {
                originalImage: `data:${file.mimetype};base64,${originalBase64}`,
                maskedImage: processedImageUrl,
                message: "Image processed successfully",
                detectedPII: piiList,
                faceCount: faceDetections.length
            };

        } catch (error) {
            console.error("Error in ImageService:", error);
            throw new Error(`Image processing failed: ${error.message}`);
        }
    }
}

module.exports = ImageService;