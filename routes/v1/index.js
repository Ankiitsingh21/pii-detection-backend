const express = require("express");
const { IamgeController } = require("../../controller/image-controller");

const router=express.Router();

router.post('/image',IamgeController);