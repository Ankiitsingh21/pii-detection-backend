const express = require("express");
const { ImageController, HealthCheck } = require("../../controller/image-controller");

const router = express.Router();

router.post('/image', ImageController);

module.exports = router;