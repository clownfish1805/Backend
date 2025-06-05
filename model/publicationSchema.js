const mongoose = require("mongoose");

const publicationSchema = new mongoose.Schema(
  {
    year: {
      type: Number,
      required: true,
    },
    volume: {
      type: String,
      required: true,
    },
    issue: {
      type: Number,
      required: true,
    },
    isSpecialIssue: {
      type: Boolean, // Flag for special issues
      required: true,
      default: false,
    },
    title: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    author: {
      type: String,
      required: true,
    },
    doi: {
      type: String, // New field for DOI
      required: true,
    },
    pdf: {
      type: String,
      required: true,
    },
    pdfContentType: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const Publication = mongoose.model("Publication", publicationSchema);

module.exports = Publication;
