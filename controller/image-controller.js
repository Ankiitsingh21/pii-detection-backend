const ImageService = require("../services/image-service");

const imageService = new ImageService();

 const IamgeController = async(req,res)=>{
        try {
        //        const response = await ImageService.Image();
               return res.status(201).json({
                message:"Image proccessed",
                data:"response",
                success:true
               });
        } catch (error) {
                console.log("Error in the controller layer",error);
                return res.status(501).json({
                        message:"Failed to proccessed",
                        error:error,
                        success:false
                });
        }
}

module.exports = { IamgeController };