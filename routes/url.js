const express = require("express")
const { handleGenerateNewShortURL, handleRedirectToURL, handleAnayticsOfURL } = require("../controllers/url")
const { restrictToLoggedInUserOnly } = require("../middlewares/auth")

const router = express.Router()

router.post("/",handleGenerateNewShortURL)

router.get("/:id",handleRedirectToURL)

router.get("/analytics/:id", restrictToLoggedInUserOnly, handleAnayticsOfURL)


module.exports= router;