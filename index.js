const express =require("express")
const cookieParser =require("cookie-parser")
const connectMongoDb =require("./connection.js")

const app=express();

const URL =require("./models/url.js")
const staticroute =require("./routes/staticroute.js")
const urlroute =require("./routes/url")
const userroute = require("./routes/user.js")
const path =require("path");
const {restrictToLoggedInUserOnly,checkAuth} = require("./middlewares/auth.js");


connectMongoDb("mongodb://localhost:27017/short-url").then(()=>{
    console.log("MongoDB connected successfully")
})

app.set("view engine","ejs")
app.set("views", path.resolve("./views"))


app.use(express.json())
app.use(express.urlencoded({extended:false}))
app.use(cookieParser())

app.use("/url",restrictToLoggedInUserOnly,urlroute)
app.use("/",checkAuth,staticroute)
app.use("/user",userroute)

app.listen(5000,()=>{
    console.log("Server running on PORT 5000")
})