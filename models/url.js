const mongoose = require("mongoose");

const visitSchema = new mongoose.Schema(
  {
    timestamps: { type: Number },
    ip:         { type: String },
    country:    { type: String },
    city:       { type: String },
    browser:    { type: String },
    os:         { type: String },
    device:     { type: String },
    referrer:   { type: String },
    isBot:      { type: Boolean, default: false },
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
    // Phase 5: Password protection, max-click expiry, and tags
    passwordHash: {
      type: String,
      default: null,
    },
    maxClicks: {
      type: Number,
      default: null,
      min: 1,
    },
    tags: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

urlSchema.index({ createdBy: 1, createdAt: -1 });
urlSchema.index({ createdBy: 1, tags: 1 });

const URL = mongoose.model("url", urlSchema);
module.exports = URL;
