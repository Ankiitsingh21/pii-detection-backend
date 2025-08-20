const express = require("express");
const  {ImageController}  = require("../../controller/image-controller");

const router=express.Router();

router.post('/image',ImageController);

const testOCR = async (req, res) => {
    try {
        const Tesseract = require('tesseract.js');
        
        // Test with a simple text image
        const { data: { text } } = await Tesseract.recognize(
            'https://tesseract.projectnaptha.com/img/eng_bw.png',
            'eng',
            { logger: m => console.log(m) }
        );
        
        res.json({
            success: true,
            text: text,
            message: "OCR test successful"
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            message: "OCR test failed"
        });
    }
};

router.get('/test-ocr', testOCR);

module.exports = router;