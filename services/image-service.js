const Tesseract = require("tesseract.js");
const Jimp = require("jimp");

class ImageService {
  async detectPII(text) {
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
      address:
        /([\u0900-\u097F]+(\s[\u0900-\u097F]+){3,})|([A-Za-z0-9\s,.-]{10,})/gu,
    };

    const detectedPII = [];
    for (const [type, pattern] of Object.entries(piiPatterns)) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        detectedPII.push({
          type,
          value: match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length,
        });
      }
    }
    // console.log(detectedPII);
    return detectedPII;
  }

  async blurRegion(image, x, y, width, height, blurRadius) {
    x = Math.max(0, x);
    y = Math.max(0, y);
    width = Math.min(width, image.bitmap.width - x);
    height = Math.min(height, image.bitmap.height - y);

    if (width <= 0 || height <= 0) return;

    const region = image.clone().crop(x, y, width, height);

    region.blur(blurRadius);

    image.composite(region, x, y);
  }

  async blurPartialText(image, word, pii) {
    const { text, bbox } = word;
    const { value, type } = pii;

    const charWidth = (bbox.x1 - bbox.x0) / text.length;

    const piiStartInWord = text.indexOf(value);
    if (piiStartInWord === -1) return; // PII not found in this word

    let blurStartX, blurWidth;

    if (type === "aadhaar") {
      const aadhaarDigits = value.replace(/\D/g, "");
      if (aadhaarDigits.length !== 12) return;

      let digitCount = 0;
      let charCount = 0;
      for (let i = 0; i < value.length && digitCount < 8; i++) {
        if (/\d/.test(value[i])) {
          digitCount++;
        }
        charCount++;
      }

      blurStartX = bbox.x0 + piiStartInWord * charWidth;
      blurWidth = charCount * charWidth;
    } else if (type === "pan") {
      if (value.length !== 10) return;

      blurStartX = bbox.x0 + piiStartInWord * charWidth;
      blurWidth = 6 * charWidth;
    } else if (type === "dob") {
      const dobParts = value.split(/[\/\-]/);
      if (dobParts.length !== 3) return;

      const dayMonthLength = dobParts[0].length + dobParts[1].length + 1; // +1 for separator
      blurStartX = bbox.x0 + piiStartInWord * charWidth;
      blurWidth = dayMonthLength * charWidth;
    } else {
      blurStartX = bbox.x0;
      blurWidth = bbox.x1 - bbox.x0;
    }

    await this.blurRegion(
      image,
      blurStartX,
      bbox.y0,
      blurWidth,
      bbox.y1 - bbox.y0,
      12,
    );
  }

  async detectFacesSimple(image) {
    const faces = [];
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    for (let y = 0; y < height; y += 10) {
      for (let x = 0; x < width; x += 10) {
        const pixelColor = Jimp.intToRGBA(image.getPixelColor(x, y));

        if (this.isSkinTone(pixelColor)) {
          const faceSize = this.checkFaceRegion(image, x, y);
          if (faceSize > 0) {
            faces.push({
              x: Math.max(0, x - faceSize / 2),
              y: Math.max(0, y - faceSize / 2),
              width: faceSize,
              height: faceSize,
            });
            x += faceSize;
            y += faceSize / 10;
          }
        }
      }
    }

    return faces;
  }

  isSkinTone(color) {
    const { r, g, b } = color;

    return (
      r > 120 &&
      r < 240 &&
      g > 80 &&
      g < 210 &&
      b > 70 &&
      b < 190 &&
      r > g &&
      r > b &&
      Math.abs(r - g) > 15 &&
      Math.abs(r - g) < 80
    );
  }

  checkFaceRegion(image, x, y) {
    const sampleSize = 20;
    let skinPixels = 0;
    let totalPixels = 0;

    for (let dy = -sampleSize / 2; dy < sampleSize / 2; dy += 2) {
      for (let dx = -sampleSize / 2; dx < sampleSize / 2; dx += 2) {
        const nx = x + dx;
        const ny = y + dy;

        if (
          nx >= 0 &&
          nx < image.bitmap.width &&
          ny >= 0 &&
          ny < image.bitmap.height
        ) {
          totalPixels++;
          const pixelColor = Jimp.intToRGBA(image.getPixelColor(nx, ny));
          if (this.isSkinTone(pixelColor)) {
            skinPixels++;
          }
        }
      }
    }

    if (totalPixels > 0 && skinPixels / totalPixels > 0.6) {
      return sampleSize * 2;
    }

    return 0;
  }

  async processImage(file) {
    try {
      if (!file || !file.buffer) {
        throw new Error("Invalid file or missing buffer");
      }

      const image = await Jimp.read(file.buffer);

      const getBase64 = (img) => {
        return new Promise((resolve, reject) => {
          img.getBuffer(Jimp.MIME_JPEG, (err, buffer) => {
            if (err) reject(err);
            resolve(buffer.toString("base64"));
          });
        });
      };

      const originalBase64 = await getBase64(image);

      let faceDetections = [];
      try {
        faceDetections = await this.detectFacesSimple(image);

        for (const face of faceDetections) {
          await this.blurRegion(
            image,
            face.x,
            face.y,
            face.width,
            face.height,
            15,
          );
        }
      } catch (error) {
        console.error("Face detection error:", error);
      }

      let piiList = [];
      let words = [];

      try {
        const result = await Tesseract.recognize(file.buffer, "eng+hin");

        const text = result.data.text;

        piiList = await this.detectPII(text);
        words = result.data.words || [];

        for (const pii of piiList) {
          const matchingWords = words.filter(
            (word) => word.text && word.text.includes(pii.value),
          );

          for (const word of matchingWords) {
            if (["aadhaar", "pan", "dob"].includes(pii.type)) {
              await this.blurPartialText(image, word, pii);
            } else {
              await this.blurRegion(
                image,
                word.bbox.x0,
                word.bbox.y0,
                word.bbox.x1 - word.bbox.x0,
                word.bbox.y1 - word.bbox.y0,
                12,
              );
            }
          }

          if (matchingWords.length === 0) {
            const partialMatches = words.filter(
              (word) => word.text && pii.value.includes(word.text),
            );

            for (const word of partialMatches) {
              await this.blurRegion(
                image,
                word.bbox.x0,
                word.bbox.y0,
                word.bbox.x1 - word.bbox.x0,
                word.bbox.y1 - word.bbox.y0,
                12,
              );
            }
          }
        }
      } catch (error) {
        console.error("OCR error:", error);
      }

      const processedBase64 = await getBase64(image);
      const processedImageUrl = `data:image/jpeg;base64,${processedBase64}`;

      return {
        originalImage: `data:${file.mimetype};base64,${originalBase64}`,
        maskedImage: processedImageUrl,
        message: "Image processed successfully",
        detectedPII: piiList,
        faceCount: faceDetections.length,
      };
    } catch (error) {
      console.error("Error in ImageService:", error);
      throw new Error(`Image processing failed: ${error.message}`);
    }
  }
}

module.exports = ImageService;
