const Tesseract = require("tesseract.js");
const sharp = require("sharp");

class ImageService {
    constructor() {
        console.log('🚀 ImageService initialized - PII Detection & Masking');
        console.log('   First run may take longer as language models download...');
    }

    async processImage(file) {
        try {
            console.log("🖼️  Starting image processing...");
            console.log(`   File: ${file.originalname} (${(file.size / 1024).toFixed(2)} KB)`);
            
            if (!file || !file.buffer) {
                throw new Error("Invalid file or missing buffer");
            }

            // Convert original to base64 for frontend preview
            const base64Image = file.buffer.toString("base64");
            const originalImageUrl = `data:${file.mimetype};base64,${base64Image}`;

            console.log("⚙️  Preprocessing image for OCR...");
            const processedBuffer = await this.preprocessForOCR(file.buffer);

            console.log("🔍 Performing OCR with word-level coordinates...");
            const ocrResult = await this.performOCRWithCoordinates(processedBuffer);

            if (!ocrResult || !ocrResult.text || ocrResult.text.trim().length === 0) {
                return {
                    originalImage: originalImageUrl,
                    maskedImage: originalImageUrl,
                    detectedPII: this.getEmptyPII(),
                    message: "No text detected in image. Try uploading a clearer image.",
                    extractedText: "",
                    ocrConfig: { confidence: 0, languages: 'none' }
                };
            }

            console.log(`📝 Extracted text (${ocrResult.confidence.toFixed(2)}% confidence):`);
            console.log("=" + "=".repeat(50));
            console.log(ocrResult.text);
            console.log("=" + "=".repeat(50));

            // Extract PII with coordinates
            console.log("🔎 Detecting PII in text...");
            const piiData = this.extractPIIWithCoordinates(ocrResult.text, ocrResult.words);

            // Create masked image
            console.log("🎭 Creating masked image...");
            const maskedImageBuffer = await this.createMaskedImage(file.buffer, piiData.coordinates);
            const maskedBase64 = maskedImageBuffer.toString("base64");
            const maskedImageUrl = `data:${file.mimetype};base64,${maskedBase64}`;

            // Log detected PII
            const foundPII = Object.entries(piiData.pii).filter(([key, value]) => value !== null && value !== '');
            if (foundPII.length > 0) {
                console.log("🎯 PII detected and masked:");
                foundPII.forEach(([key, value]) => {
                    if (key === 'aadhaar' && value) {
                        console.log(`   ${key}: ${value.substring(0,4)}****${value.substring(8)}`);
                    } else {
                        console.log(`   ${key}: ${value}`);
                    }
                });
                console.log(`   Total regions masked: ${piiData.coordinates.length}`);
            } else {
                console.log("ℹ️  No PII detected - no masking applied");
            }

            return {
                originalImage: originalImageUrl,
                maskedImage: maskedImageUrl,
                detectedPII: piiData.pii,
                message: foundPII.length > 0 ? 
                    `Successfully detected and masked ${foundPII.length} PII field(s)` : 
                    "No PII detected in the image",
                extractedText: ocrResult.text,
                ocrConfig: {
                    confidence: ocrResult.confidence,
                    languages: 'eng+hin',
                    maskedRegions: piiData.coordinates.length
                }
            };

        } catch (error) {
            console.error("❌ Error in ImageService:", error);
            throw new Error(`Image processing failed: ${error.message}`);
        }
    }

    async preprocessForOCR(buffer) {
        try {
            return await sharp(buffer)
                .resize(2500, 2500, { 
                    fit: 'inside', 
                    withoutEnlargement: false,
                    kernel: sharp.kernel.lanczos3 
                })
                .grayscale()
                .normalize()
                .linear(1.3, -(128 * 1.3) + 128) // Enhance contrast
                .sharpen({ sigma: 1.5, flat: 1, jagged: 2 })
                .median(1) // Remove noise
                .png({ quality: 100, compressionLevel: 0 })
                .toBuffer();
        } catch (error) {
            console.warn("⚠️  Preprocessing failed, using original:", error.message);
            return buffer;
        }
    }

    async performOCRWithCoordinates(buffer) {
        const ocrOptions = {
            tessedit_pageseg_mode: 6,
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/-:.,() ।आधारपानकार्डनामजन्मतिथिपिता',
            preserve_interword_spaces: '1',
            tessedit_ocr_engine_mode: 1,
            logger: m => {
                if (m.status === 'recognizing text') {
                    process.stdout.write(`\r   OCR Progress: ${Math.round(m.progress * 100)}%`);
                }
            }
        };

        try {
            console.log("   Attempting OCR with English + Hindi...");
            const result = await Tesseract.recognize(buffer, "eng+hin", ocrOptions);
            
            console.log(''); // New line after progress
            
            return {
                text: result.data.text.trim(),
                confidence: result.data.confidence || 0,
                words: result.data.words || [],
                lines: result.data.lines || []
            };
        } catch (error) {
            console.log(`\n⚠️  OCR failed: ${error.message}`);
            console.log("   Trying English only...");
            
            try {
                const fallbackResult = await Tesseract.recognize(buffer, "eng", ocrOptions);
                console.log('✅ OCR completed with English only');
                
                return {
                    text: fallbackResult.data.text.trim(),
                    confidence: fallbackResult.data.confidence || 0,
                    words: fallbackResult.data.words || [],
                    lines: fallbackResult.data.lines || []
                };
            } catch (fallbackError) {
                throw new Error(`All OCR attempts failed: ${fallbackError.message}`);
            }
        }
    }

    extractPIIWithCoordinates(text, words) {
        const pii = this.getEmptyPII();
        const coordinates = [];

        // Detect document type
        this.detectDocumentType(text, pii);

        // Extract different types of PII with their coordinates
        this.extractDOBWithCoordinates(text, words, pii, coordinates);
        this.extractAadhaarWithCoordinates(text, words, pii, coordinates);
        this.extractPANWithCoordinates(text, words, pii, coordinates);
        this.extractNamesWithCoordinates(text, words, pii, coordinates);
        this.extractPhoneWithCoordinates(text, words, pii, coordinates);
        
        // Add photo masking (face region) for all ID documents
        if (pii.hasPhoto) {
            coordinates.push(this.estimatePhotoRegion());
        }

        return { pii, coordinates };
    }

    extractDOBWithCoordinates(text, words, pii, coordinates) {
        // DOB patterns
        const dobPatterns = [
            /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})\b/g,
            /DOB:?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/gi,
            /जन्म\s*तिथि[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/gi
        ];

        for (const pattern of dobPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const dobText = match[1] || match[0];
                
                // Validate date format
                if (this.isValidDate(dobText)) {
                    pii.dob = dobText;
                    
                    // Find coordinates of DOB in words
                    const dobCoords = this.findTextCoordinates(dobText, words);
                    if (dobCoords.length > 0) {
                        coordinates.push(...dobCoords);
                        console.log(`   🎯 DOB found: ${dobText} (${dobCoords.length} regions)`);
                    }
                    break;
                }
            }
            if (pii.dob) break;
        }
    }

    extractAadhaarWithCoordinates(text, words, pii, coordinates) {
        // Multiple Aadhaar patterns
        const aadhaarPatterns = [
            /\b(\d{4}\s+\d{4}\s+\d{4})\b/g,
            /\b(\d{4}\s*\d{4}\s*\d{4})\b/g,
            /(\d{12})/g
        ];

        const cleanText = text.replace(/[^\d\s]/g, ' ');
        const numbers = cleanText.match(/\d+/g) || [];
        
        // Look for 12-digit sequences
        for (const num of numbers) {
            if (num.length === 12 && this.isValidAadhaar(num)) {
                pii.aadhaar = num;
                
                // Find this number in the original text with various formats
                const formats = [
                    num,
                    `${num.slice(0,4)} ${num.slice(4,8)} ${num.slice(8,12)}`,
                    `${num.slice(0,4)}-${num.slice(4,8)}-${num.slice(8,12)}`
                ];
                
                for (const format of formats) {
                    const aadhaarCoords = this.findTextCoordinates(format, words, true);
                    if (aadhaarCoords.length > 0) {
                        coordinates.push(...aadhaarCoords);
                        console.log(`   🎯 Aadhaar found: ${num.substring(0,4)}****${num.substring(8)} (${aadhaarCoords.length} regions)`);
                        return;
                    }
                }
                break;
            }
        }
    }

    extractPANWithCoordinates(text, words, pii, coordinates) {
        const panPattern = /\b([A-Z]{5}\d{4}[A-Z])\b/g;
        let match;
        
        while ((match = panPattern.exec(text)) !== null) {
            const panNumber = match[1];
            pii.pan = panNumber;
            
            const panCoords = this.findTextCoordinates(panNumber, words);
            if (panCoords.length > 0) {
                coordinates.push(...panCoords);
                console.log(`   🎯 PAN found: ${panNumber} (${panCoords.length} regions)`);
            }
            break;
        }
    }

    extractNamesWithCoordinates(text, words, pii, coordinates) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
        
        // Strategy 1: Look for name after "Name" keyword
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].toLowerCase();
            if (line.includes('name') && !line.includes('father')) {
                if (i + 1 < lines.length) {
                    const nameCandidate = this.cleanName(lines[i + 1]);
                    if (this.isValidName(nameCandidate)) {
                        pii.name = nameCandidate;
                        const nameCoords = this.findTextCoordinates(nameCandidate, words, true);
                        if (nameCoords.length > 0) {
                            coordinates.push(...nameCoords);
                            console.log(`   🎯 Name found: ${nameCandidate} (${nameCoords.length} regions)`);
                        }
                        break;
                    }
                }
            }
        }

        // Strategy 2: Look for father's name
        const fatherKeywords = ['father', 'पिता', 's/o', 'son of'];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].toLowerCase();
            for (const keyword of fatherKeywords) {
                if (line.includes(keyword)) {
                    if (i + 1 < lines.length) {
                        const fatherNameCandidate = this.cleanName(lines[i + 1]);
                        if (this.isValidName(fatherNameCandidate)) {
                            pii.fatherName = fatherNameCandidate;
                            const fatherCoords = this.findTextCoordinates(fatherNameCandidate, words, true);
                            if (fatherCoords.length > 0) {
                                coordinates.push(...fatherCoords);
                                console.log(`   🎯 Father's name found: ${fatherNameCandidate} (${fatherCoords.length} regions)`);
                            }
                        }
                    }
                    break;
                }
            }
        }
    }

    extractPhoneWithCoordinates(text, words, pii, coordinates) {
        const phonePatterns = [
            /\b(\+91[\s\-]?\d{10})\b/g,
            /\b([6-9]\d{9})\b/g
        ];

        for (const pattern of phonePatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const phoneNumber = match[1];
                pii.phone = phoneNumber;
                
                const phoneCoords = this.findTextCoordinates(phoneNumber, words);
                if (phoneCoords.length > 0) {
                    coordinates.push(...phoneCoords);
                    console.log(`   🎯 Phone found: ${phoneNumber} (${phoneCoords.length} regions)`);
                }
                break;
            }
            if (pii.phone) break;
        }
    }

    findTextCoordinates(searchText, words, fuzzyMatch = false) {
        const coordinates = [];
        const searchWords = searchText.toLowerCase().split(/\s+/);
        
        if (fuzzyMatch) {
            // For names and fuzzy matching
            for (const word of words) {
                if (word.text && word.text.length > 2) {
                    const wordText = word.text.toLowerCase().replace(/[^\w]/g, '');
                    const searchTextClean = searchText.toLowerCase().replace(/[^\w]/g, '');
                    
                    if (wordText.includes(searchTextClean) || 
                        searchTextClean.includes(wordText) ||
                        this.levenshteinDistance(wordText, searchTextClean) <= 2) {
                        
                        coordinates.push({
                            left: word.bbox.x0,
                            top: word.bbox.y0,
                            width: word.bbox.x1 - word.bbox.x0,
                            height: word.bbox.y1 - word.bbox.y0
                        });
                    }
                }
            }
        } else {
            // Exact matching for numbers, PAN, etc.
            for (let i = 0; i < words.length; i++) {
                const word = words[i];
                if (word.text && word.text.toLowerCase().includes(searchWords[0].toLowerCase())) {
                    // Found first word, check if subsequent words match
                    let allMatch = true;
                    const matchingWords = [word];
                    
                    for (let j = 1; j < searchWords.length && i + j < words.length; j++) {
                        const nextWord = words[i + j];
                        if (!nextWord.text || 
                            !nextWord.text.toLowerCase().includes(searchWords[j].toLowerCase())) {
                            allMatch = false;
                            break;
                        }
                        matchingWords.push(nextWord);
                    }
                    
                    if (allMatch || searchWords.length === 1) {
                        // Add bounding box for all matching words
                        const minX = Math.min(...matchingWords.map(w => w.bbox.x0));
                        const minY = Math.min(...matchingWords.map(w => w.bbox.y0));
                        const maxX = Math.max(...matchingWords.map(w => w.bbox.x1));
                        const maxY = Math.max(...matchingWords.map(w => w.bbox.y1));
                        
                        coordinates.push({
                            left: minX,
                            top: minY,
                            width: maxX - minX,
                            height: maxY - minY
                        });
                    }
                }
            }
        }
        
        return coordinates;
    }

    estimatePhotoRegion() {
        // Standard photo position for Indian ID cards (usually top-left)
        return {
            left: 50,
            top: 50,
            width: 150,
            height: 180,
            type: 'photo'
        };
    }

    async createMaskedImage(originalBuffer, coordinates) {
        try {
            if (coordinates.length === 0) {
                return originalBuffer; // No masking needed
            }

            const image = sharp(originalBuffer);
            const metadata = await image.metadata();
            
            // Create blur overlays for each coordinate
            const overlays = [];
            
            for (const coord of coordinates) {
                // Add padding around the detected region
                const padding = 10;
                const left = Math.max(0, coord.left - padding);
                const top = Math.max(0, coord.top - padding);
                const width = Math.min(metadata.width - left, coord.width + (padding * 2));
                const height = Math.min(metadata.height - top, coord.height + (padding * 2));
                
                if (width > 0 && height > 0) {
                    // Create a blur overlay
                    const blurOverlay = await sharp({
                        create: {
                            width: Math.round(width),
                            height: Math.round(height),
                            channels: 4,
                            background: { r: 0, g: 0, b: 0, alpha: 0.8 }
                        }
                    })
                    .png()
                    .toBuffer();
                    
                    overlays.push({
                        input: blurOverlay,
                        left: Math.round(left),
                        top: Math.round(top)
                    });
                }
            }

            // Apply all overlays to the image
            let maskedImage = image;
            if (overlays.length > 0) {
                maskedImage = image.composite(overlays);
            }

            return await maskedImage.jpeg({ quality: 90 }).toBuffer();
            
        } catch (error) {
            console.error("Error creating masked image:", error);
            return originalBuffer; // Return original on error
        }
    }

    // Helper methods
    getEmptyPII() {
        return {
            name: null,
            dob: null,
            aadhaar: null,
            address: null,
            phone: null,
            email: null,
            pan: null,
            fatherName: null,
            documentType: null,
            hasPhoto: false
        };
    }

    detectDocumentType(text, pii) {
        const lowerText = text.toLowerCase();
        
        if (lowerText.includes('income tax') || lowerText.includes('permanent account')) {
            pii.documentType = 'PAN Card';
            pii.hasPhoto = true;
        } else if (lowerText.includes('aadhaar') || lowerText.includes('आधार') || lowerText.includes('uidai')) {
            pii.documentType = 'Aadhaar Card';
            pii.hasPhoto = true;
        } else if (lowerText.includes('driving licence') || lowerText.includes('transport')) {
            pii.documentType = 'Driving License';
            pii.hasPhoto = true;
        } else {
            pii.documentType = 'Government ID';
            pii.hasPhoto = true;
        }
    }

    isValidDate(dateStr) {
        const datePattern = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/;
        const match = dateStr.match(datePattern);
        
        if (!match) return false;
        
        const day = parseInt(match[1]);
        const month = parseInt(match[2]);
        const year = parseInt(match[3]);
        
        return (day >= 1 && day <= 31) && 
               (month >= 1 && month <= 12) && 
               (year >= 1900 && year <= new Date().getFullYear());
    }

    isValidAadhaar(aadhaar) {
        return aadhaar.length === 12 && 
               /^\d{12}$/.test(aadhaar) && 
               aadhaar[0] !== '0' && 
               aadhaar[0] !== '1';
    }

    cleanName(name) {
        return name
            .replace(/[|]/g, ' ')
            .replace(/\d+/g, ' ')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();
    }

    isValidName(name) {
        return name && 
               name.length > 2 && 
               name.length < 50 && 
               !/^\d+$/.test(name) &&
               !name.toLowerCase().includes('income') &&
               !name.toLowerCase().includes('tax') &&
               !name.toLowerCase().includes('department');
    }

    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }
}

module.exports = ImageService;