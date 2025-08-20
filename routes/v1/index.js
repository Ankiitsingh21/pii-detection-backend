const express = require("express");
const  {ImageController}  = require("../../controller/image-controller");

const router=express.Router();

router.post('/image',ImageController);

module.exports = router;