const Tesseract = require("tesseract.js");
const sharp = require("sharp");

class ImageService {
    constructor() {
        console.log('🚀 ImageService initialized - using automatic tessdata download');
        console.log('   First run may take longer as language models download...');
    }

    async processImage(file) {
        try {
            console.log("🖼️  Starting image processing...");
            console.log(`   File: ${file.originalname} (${(file.size / 1024).toFixed(2)} KB)`);
            
            if (!file || !file.buffer) {
                throw new Error("Invalid file or missing buffer");
            }

            // Convert to base64 for frontend preview
            const base64Image = file.buffer.toString("base64");
            const imageUrl = `data:${file.mimetype};base64,${base64Image}`;

            console.log("⚙️  Processing image with Sharp...");
            
            // Enhanced preprocessing for Indian government documents
            let processedBuffer;
            try {
                processedBuffer = await sharp(file.buffer)
                    .resize({ 
                        width: 3000, 
                        height: 3000, 
                        fit: 'inside', 
                        withoutEnlargement: true 
                    })
                    .grayscale()
                    .normalize()
                    .linear(1.2, -(128 * 1.2) + 128) // Increase contrast
                    .sharpen({ sigma: 1.5, flat: 1, jagged: 2 })
                    .median(1) // Reduce noise
                    .jpeg({ quality: 100 })
                    .toBuffer();
                
                console.log(`   Image processed: ${(processedBuffer.length / 1024).toFixed(2)} KB`);
            } catch (sharpError) {
                console.warn("⚠️  Sharp processing failed, using original buffer:", sharpError.message);
                processedBuffer = file.buffer;
            }

            console.log("🔍 Starting OCR with Tesseract...");
            console.log("   Using automatic tessdata download 🌐");

            // Configure OCR options - optimized for Aadhaar cards
            const ocrOptions = {
                tessedit_pageseg_mode: 6, // Assume a single uniform block of text
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/-:.,() ।',
                preserve_interword_spaces: '1',
                tessedit_do_invert: '0',
                logger: m => {
                    if (m.status === 'recognizing text') {
                        process.stdout.write(`\r   OCR Progress: ${Math.round(m.progress * 100)}%`);
                    } else if (m.status === 'loading lang') {
                        console.log(`\n   Loading language model: ${Math.round(m.progress * 100)}%`);
                    } else if (m.status === 'downloading lang') {
                        console.log(`\n   Downloading ${m.userJobId}: ${Math.round(m.progress * 100)}%`);
                    }
                }
            };

            // Run OCR with fallback strategy
            let ocrResult;
            let languagesUsed = '';
            
            try {
                console.log("   Attempting OCR with English + Hindi...");
                ocrResult = await Tesseract.recognize(
                    processedBuffer,
                    "eng+hin",
                    ocrOptions
                );
                languagesUsed = 'eng+hin';
                console.log('\n✅ OCR completed with English + Hindi');
            } catch (ocrError) {
                console.log(`\n⚠️  Hindi+English OCR failed: ${ocrError.message}`);
                console.log("   Trying English only...");
                
                try {
                    ocrResult = await Tesseract.recognize(
                        processedBuffer,
                        "eng",
                        ocrOptions
                    );
                    languagesUsed = 'eng';
                    console.log('✅ OCR completed with English only');
                } catch (fallbackError) {
                    console.error("❌ All OCR attempts failed:", fallbackError);
                    throw new Error(`OCR failed: ${fallbackError.message}`);
                }
            }

            const text = ocrResult.data.text.trim();
            console.log(`\n📝 Extracted text length: ${text.length} characters`);
            
            if (text.length > 0) {
                console.log("📄 Raw extracted text:");
                console.log("=" + "=".repeat(50));
                console.log(text);
                console.log("=" + "=".repeat(50));
                
                // Debug: Show all numbers found in text
                const allNumbers = text.match(/\d+/g) || [];
                console.log(`🔢 All numbers found: ${allNumbers.join(', ')}`);
            }

            if (!text || text.length === 0) {
                return {
                    originalImage: imageUrl,
                    maskedImage: imageUrl,
                    detectedPII: { name: null, dob: null, aadhaar: null, address: null },
                    message: "No text detected in image. Try uploading a clearer image.",
                    extractedText: "",
                    ocrConfig: {
                        usedLocalTessdata: false,
                        languages: languagesUsed,
                        confidence: 0
                    }
                };
            }

            // Extract PII
            console.log("🔎 Extracting PII information...");
            const pii = this.extractPII(text);
            
            // Log found PII
            const foundPII = Object.entries(pii).filter(([key, value]) => value !== null);
            if (foundPII.length > 0) {
                console.log("🎯 PII detected:");
                foundPII.forEach(([key, value]) => {
                    console.log(`   ${key}: ${value}`);
                });
            } else {
                console.log("ℹ️  No PII patterns detected");
            }

            return {
                originalImage: imageUrl,
                maskedImage: imageUrl, // TODO: implement actual masking
                detectedPII: pii,
                message: "Image processed successfully",
                extractedText: text,
                ocrConfig: {
                    usedLocalTessdata: false,
                    languages: languagesUsed,
                    confidence: ocrResult.data.confidence || 0,
                    processingTime: new Date().toISOString()
                }
            };

        } catch (error) {
            console.error("❌ Error in ImageService:", error);
            throw new Error(`Image processing failed: ${error.message}`);
        }
    }

    extractPII(text) {
        try {
            console.log("🔍 Running PII extraction patterns...");
            
            // Enhanced regex patterns for Indian documents
            const patterns = {
                // Date patterns (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY)
                dob: [
                    /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})\b/g,
                    /\b(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/g // YYYY/MM/DD format
                ],
                
                // Enhanced Aadhaar patterns - more comprehensive
                aadhaar: [
                    /\b(\d{4}\s+\d{4}\s+\d{4})\b/g,        // 4 digits space 4 digits space 4 digits
                    /\b(\d{4}\s*\d{4}\s*\d{4})\b/g,        // With optional spaces
                    /(\d{4}[\s\-]\d{4}[\s\-]\d{4})/g,      // With spaces or hyphens
                    /(\d{12})/g,                            // 12 consecutive digits
                    /(\d{4}\.\d{4}\.\d{4})/g,              // With dots
                    /(\d{4}\/\d{4}\/\d{4})/g,              // With slashes
                ],
                
                // Phone patterns
                phone: [
                    /\b(\+91[\s\-]?\d{10})\b/g,
                    /\b([6-9]\d{9})\b/g
                ],
                
                // Email patterns
                email: /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
                
                // PAN card pattern
                pan: /\b([A-Z]{5}\d{4}[A-Z])\b/g
            };

            const results = {
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

            // Detect document type and photo presence
            console.log("🔍 Detecting document type and photo...");
            if (text.toLowerCase().includes('income tax') || text.toLowerCase().includes('permanent account')) {
                results.documentType = 'PAN Card';
                results.hasPhoto = true; // PAN cards always have photos
                console.log("   Document Type: PAN Card");
                console.log("   Has Photo: Yes");
            } else if (text.toLowerCase().includes('aadhaar') || text.toLowerCase().includes('आधार') || text.toLowerCase().includes('uidai')) {
                results.documentType = 'Aadhaar Card';
                results.hasPhoto = true; // Aadhaar cards always have photos
                console.log("   Document Type: Aadhaar Card");
                console.log("   Has Photo: Yes");
            } else if (text.toLowerCase().includes('driving licence') || text.toLowerCase().includes('transport')) {
                results.documentType = 'Driving License';
                results.hasPhoto = true;
                console.log("   Document Type: Driving License");
                console.log("   Has Photo: Yes");
            } else {
                results.documentType = 'Unknown';
                results.hasPhoto = true; // Assume has photo for safety
                console.log("   Document Type: Unknown (assuming has photo for safety)");
            }

            // Extract using patterns
            let matches;

            // DOB extraction
            for (const pattern of patterns.dob) {
                matches = text.match(pattern);
                if (matches) {
                    results.dob = matches[0];
                    console.log(`   Found DOB: ${results.dob}`);
                    break;
                }
            }

            // PAN extraction
            matches = text.match(patterns.pan);
            if (matches) {
                results.pan = matches[0];
                console.log(`   Found PAN: ${results.pan}`);
            }

            // Enhanced Aadhaar extraction with multiple strategies
            console.log("🔍 Looking for Aadhaar number...");
            
            // Strategy 1: Try all Aadhaar patterns
            let aadhaarFound = false;
            for (const pattern of patterns.aadhaar) {
                const matches = text.match(pattern);
                if (matches) {
                    console.log(`   Pattern matched: ${pattern}`);
                    console.log(`   Matches found: ${matches}`);
                    
                    for (const match of matches) {
                        const cleanAadhaar = match.replace(/[\s\-\.\/]/g, '');
                        console.log(`   Cleaned Aadhaar: ${cleanAadhaar} (length: ${cleanAadhaar.length})`);
                        
                        // Validate Aadhaar number (should be 12 digits)
                        if (cleanAadhaar.length === 12 && /^\d{12}$/.test(cleanAadhaar)) {
                            // Basic Aadhaar validation (first digit should not be 0 or 1)
                            if (cleanAadhaar[0] !== '0' && cleanAadhaar[0] !== '1') {
                                results.aadhaar = cleanAadhaar;
                                aadhaarFound = true;
                                console.log(`   ✅ Valid Aadhaar found: ${results.aadhaar.substring(0,4)}****${results.aadhaar.substring(8)}`);
                                break;
                            }
                        }
                    }
                    if (aadhaarFound) break;
                }
            }
            
            // Strategy 2: Look for numbers near "Aadhaar" keywords
            if (!aadhaarFound) {
                console.log("   Strategy 2: Looking near Aadhaar keywords...");
                const aadhaarKeywords = ['aadhaar', 'आधार', 'uid', 'uidai'];
                const lines = text.split('\n').map(l => l.trim());
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].toLowerCase();
                    for (const keyword of aadhaarKeywords) {
                        if (line.includes(keyword)) {
                            console.log(`   Found keyword "${keyword}" in line: ${lines[i]}`);
                            
                            // Check current line and next few lines for numbers
                            for (let j = i; j < Math.min(lines.length, i + 3); j++) {
                                const numberLine = lines[j];
                                const numbers = numberLine.match(/\d+/g);
                                if (numbers) {
                                    console.log(`   Numbers in line ${j}: ${numbers}`);
                                    
                                    for (const num of numbers) {
                                        if (num.length === 12 && /^\d{12}$/.test(num)) {
                                            if (num[0] !== '0' && num[0] !== '1') {
                                                results.aadhaar = num;
                                                aadhaarFound = true;
                                                console.log(`   ✅ Aadhaar found near keyword: ${results.aadhaar.substring(0,4)}****${results.aadhaar.substring(8)}`);
                                                break;
                                            }
                                        }
                                    }
                                    if (aadhaarFound) break;
                                }
                            }
                            if (aadhaarFound) break;
                        }
                    }
                    if (aadhaarFound) break;
                }
            }
            
            // Strategy 3: Extract all 12-digit numbers from entire text
            if (!aadhaarFound) {
                console.log("   Strategy 3: Extracting all 12-digit sequences...");
                const allNumbers = text.replace(/[^\d\s]/g, ' ').split(/\s+/);
                console.log(`   All number sequences: ${allNumbers.filter(n => n.length >= 4)}`);
                
                for (const num of allNumbers) {
                    if (num.length === 12 && /^\d{12}$/.test(num)) {
                        if (num[0] !== '0' && num[0] !== '1') {
                            results.aadhaar = num;
                            console.log(`   ✅ 12-digit number found: ${results.aadhaar.substring(0,4)}****${results.aadhaar.substring(8)}`);
                            break;
                        }
                    }
                }
            }

            if (!results.aadhaar) {
                console.log("   ❌ No Aadhaar number detected");
            }

            // Phone extraction
            for (const pattern of patterns.phone) {
                matches = text.match(pattern);
                if (matches) {
                    results.phone = matches[0];
                    console.log(`   Found Phone: ${results.phone}`);
                    break;
                }
            }

            // Email extraction
            matches = text.match(patterns.email);
            if (matches) {
                results.email = matches[0];
                console.log(`   Found Email: ${results.email}`);
            }

            // Enhanced name extraction with multiple strategies
            console.log("🔍 Extracting name...");
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
            
            // Strategy 1: Look for name keywords (PAN Card specific)
            const nameKeywords = ['name', 'नाम', 'श्री', 'श्रीमति', 'कुमारी'];
            let nameFound = false;

            for (let i = 0; i < lines.length && !nameFound; i++) {
                const line = lines[i].toLowerCase();
                
                // Check if line contains "name" keyword
                if (line.includes('name') && !line.includes('father')) {
                    console.log(`   Found "name" keyword in line: ${lines[i]}`);
                    
                    // Check next line for the actual name
                    if (i + 1 < lines.length) {
                        const nextLine = lines[i + 1].trim();
                        console.log(`   Next line: ${nextLine}`);
                        
                        // Clean the name line
                        const cleanName = nextLine
                            .replace(/[|]/g, ' ')           // Remove pipe symbols
                            .replace(/\d+/g, ' ')           // Remove numbers
                            .replace(/[^\w\s]/g, ' ')       // Remove special characters except spaces
                            .replace(/\s+/g, ' ')           // Multiple spaces to single
                            .trim();
                            
                        if (cleanName.length > 2 && cleanName.length < 50) {
                            results.name = cleanName.toUpperCase();
                            nameFound = true;
                            console.log(`   ✅ Name extracted: ${results.name}`);
                        }
                    }
                }
            }

            // Strategy 2: For PAN cards, look after PAN number
            if (!nameFound && results.pan && results.documentType === 'PAN Card') {
                console.log("   Strategy 2: Looking near PAN number...");
                
                const panIndex = lines.findIndex(l => l.includes(results.pan));
                if (panIndex >= 0) {
                    // Look in surrounding lines for name
                    const searchLines = lines.slice(Math.max(0, panIndex - 2), panIndex + 3);
                    
                    for (const searchLine of searchLines) {
                        if (!searchLine.includes(results.pan) && !searchLine.toLowerCase().includes('father')) {
                            const cleanName = searchLine
                                .replace(/[|]/g, ' ')
                                .replace(/\d+/g, ' ')
                                .replace(/[^\w\s]/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim();
                                
                            if (cleanName.length > 2 && cleanName.length < 50 && 
                                !cleanName.toLowerCase().includes('income') &&
                                !cleanName.toLowerCase().includes('tax') &&
                                !cleanName.toLowerCase().includes('department')) {
                                results.name = cleanName.toUpperCase();
                                nameFound = true;
                                console.log(`   ✅ Name found near PAN: ${results.name}`);
                                break;
                            }
                        }
                    }
                }
            }

            // Strategy 3: Look for father's name pattern
            console.log("🔍 Looking for father's name...");
            const fatherKeywords = ['father', 'पिता', 'पित्र', 'father\'s name', 's/o', 'son of'];
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].toLowerCase();
                for (const keyword of fatherKeywords) {
                    if (line.includes(keyword.toLowerCase())) {
                        console.log(`   Found father keyword "${keyword}" in: ${lines[i]}`);
                        
                        // Check next line for father's name
                        if (i + 1 < lines.length) {
                            const fatherLine = lines[i + 1].trim();
                            const cleanFatherName = fatherLine
                                .replace(/[|]/g, ' ')
                                .replace(/\d+/g, ' ')
                                .replace(/[^\w\s]/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim();
                                
                            if (cleanFatherName.length > 2 && cleanFatherName.length < 50) {
                                results.fatherName = cleanFatherName.toUpperCase();
                                console.log(`   ✅ Father's name: ${results.fatherName}`);
                                break;
                            }
                        }
                        
                        // If we found father's name but not main name, 
                        // look for main name in previous lines
                        if (!nameFound && results.fatherName) {
                            for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
                                const prevLine = lines[j];
                                if (!prevLine.toLowerCase().includes('name') && 
                                    !prevLine.toLowerCase().includes('income') &&
                                    !prevLine.toLowerCase().includes('tax')) {
                                    
                                    const cleanName = prevLine
                                        .replace(/[|]/g, ' ')
                                        .replace(/\d+/g, ' ')
                                        .replace(/[^\w\s]/g, ' ')
                                        .replace(/\s+/g, ' ')
                                        .trim();
                                        
                                    if (cleanName.length > 2 && cleanName.length < 50) {
                                        results.name = cleanName.toUpperCase();
                                        nameFound = true;
                                        console.log(`   ✅ Name found before father's name: ${results.name}`);
                                        break;
                                    }
                                }
                            }
                        }
                        break;
                    }
                }
            }

            if (!results.name) {
                console.log("   ⚠️  Could not extract clear name - may need manual review");
            }

            // PAN extraction
            matches = text.match(patterns.pan);
            if (matches) {
                results.pan = matches[0];
                console.log(`   Found PAN: ${results.pan}`);
            }

            // Enhanced address extraction
            const addressKeywords = ['address', 'addr', 'पता', 'स्थायी', 'निवास', 'house', 'village', 'city'];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].toLowerCase();
                if (addressKeywords.some(keyword => line.includes(keyword))) {
                    // Take next 2-4 lines as address
                    const addressLines = lines.slice(i + 1, i + 5).filter(l => 
                        l.length > 5 && 
                        !l.toLowerCase().includes('dob') && 
                        !l.toLowerCase().includes('mobile')
                    );
                    if (addressLines.length > 0) {
                        results.address = addressLines.join(', ');
                        console.log(`   Found Address: ${results.address.substring(0, 50)}...`);
                        break;
                    }
                }
            }

            return results;

        } catch (error) {
            console.error("❌ Error extracting PII:", error);
            return { 
                name: null, dob: null, aadhaar: null, address: null, 
                phone: null, email: null, pan: null, fatherName: null,
                documentType: null, hasPhoto: false 
            };
        }
    }
}

module.exports = ImageService;