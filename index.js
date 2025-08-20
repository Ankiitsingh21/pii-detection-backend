const express = require("express");
const {PORT} = require("./config/serverConfig");
const bodyParser = require("body-parser");
const apiRoutes = require("./routes/index");

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(cors({
    origin: "http://localhost:5173", // Your React app URL
    credentials: true
}));


app.use("/api",apiRoutes);

app.listen(PORT,()=>{
        console.log(`Server Started on ${PORT}`);
});