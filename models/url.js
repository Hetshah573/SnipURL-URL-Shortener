const mongoose = require("mongoose");

const visitSchema = new mongoose.Schema({
  timestamps: { type: Number },      // epoch ms
  ip:         { type: String },      // visitor IP (hashed for privacy)
  country:    { type: String },      // e.g. "IN", "US"
  city:       { type: String },      // e.g. "Mumbai"
  browser:    { type: String },      // e.g. "Chrome"
  os:         { type: String },      // e.g. "Windows"
  device:     { type: String },      // "desktop" | "mobile" | "tablet"
  referrer:   { type: String },      // referring URL or "(direct)"
}, { _id: false });

const urlSchema = new mongoose.Schema(
  {
    shortId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    redirectId: {
      type: String,
      required: true,
    },
    visitHistory: [visitSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const URL = mongoose.model("url", urlSchema);
module.exports = URL;
