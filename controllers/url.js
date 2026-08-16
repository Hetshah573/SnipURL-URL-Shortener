const URL = require("../models/url")
const shortid =require("shortid");

async function handleGenerateNewShortURL(req,res){
    const id =req.body.id;
    if(!id) return res.status(400).json({msg: "Original URL required for generating new short URL"})
    const shortID = shortid();
    const result = await URL.create({
        shortId: shortID,
        redirectId: id,
        visitHistory: [],
        createdBy: req.user._id,
    })
    return res.render('home',{
        id : shortID
    })
    // return res.status(201).json({ id : shortID })
}

async function handleRedirectToURL(req,res){
    const shortId =req.params.id;
    if(!shortId) return res.status(404).json({ msg:`Page not found`})

    const result = await URL.findOneAndUpdate({shortId},{
         $push: { visitHistory: { timestamps: Date.now(), } }
    })
    if(!result){
        return res.status(400).json({msg:"No redirecting page found for this ID",id:shortid})
    }
    return res.redirect(result.redirectId)
}

async function handleAnayticsOfURL(req,res){
    const shortId =req.params.id;
    if(!shortId) return res.status(404).json({ msg:`Page not found`})
    const result =await URL.findOne({shortId, createdBy: req.user._id});
    if(!result){
        return res.status(403).json({msg:"Forbidden: You do not own this URL"})
    }
    return res.render('analytics', {
        shortId: result.shortId,
        redirectId: result.redirectId,
        totalClicks: result.visitHistory.length,
        visitHistory: result.visitHistory,
        createdAt: new Date(result.createdAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    })
}

module.exports = {
    handleGenerateNewShortURL,
    handleRedirectToURL,
    handleAnayticsOfURL
}