const mongoose = require("mongoose");

const visitSchema = new mongoose.Schema(
  {
    timestamps: { type: Number },  // epoch ms
    ip:         { type: String },  // visitor IP (hashed for privacy)
    country:    { type: String },  // e.g. "IN", "US"
    city:       { type: String },  // e.g. "Mumbai"
    browser:    { type: String },  // e.g. "Chrome"
    os:         { type: String },  // e.g. "Windows"
    device:     { type: String },  // "Desktop" | "Mobile" | "Tablet" | "Other"
    referrer:   { type: String },  // referring URL or "(direct)"
    isBot:      { type: Boolean, default: false }, // Phase 4: bot/crawler flag
  },
  { _id: false }
);

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
      index: true,
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

urlSchema.index({ createdBy: 1, createdAt: -1 });

const URL = mongoose.model("url", urlSchema);
module.exports = URL;
