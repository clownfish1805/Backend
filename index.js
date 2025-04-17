const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// Import Schema
// const Publication = require(path.join(__dirname, "model/publicationSchema"));

// Configure Multer for PDF uploads (store in memory)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed!"), false);
    }
  },
});

// Middleware for Logging Requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// 🔹 Download PDF Route
app.get("/download-pdf/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const response = await axios.get(`http://61.2.79.154:15002/publications/${id}`, {
      responseType: "arraybuffer",
    });

    const publication = response.data;

    if (!publication || !publication.pdf) {
      return res.status(404).json({ error: "PDF not found." });
    }

    res.set("Content-Type", publication.pdfContentType || "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${publication.title}.pdf"`);
    res.send(publication.pdf);
  } catch (err) {
    console.error("Error downloading PDF:", err.message);
    res.status(500).json({ error: "Failed to download PDF." });
  }
});

// 1. Fetch all distinct years
app.get("/years", async (req, res) => {
  try {
    const response = await axios.get("http://61.2.79.154:15002/years");
    res.json(response.data);
  } catch (err) {
    console.error("Error fetching years:", err.message);
    res.status(500).json({ error: "Failed to fetch years." });
  }
});

// 2. Fetch volumes under a specific year
app.get("/volumes", async (req, res) => {
  const { year } = req.query;

  if (!year) {
    return res.status(400).json({ error: "Year parameter is required." });
  }

  try {
    const response = await axios.get("http://61.2.79.154:15002/volumes", { params: { year } });
    res.json(response.data);
  } catch (err) {
    console.error("Error fetching volumes:", err.message);
    res.status(500).json({ error: "Failed to fetch volumes." });
  }
});

// 3. Fetch data for a specific year and volume
app.get("/publications", async (req, res) => {
  try {
    const response = await axios.get("http://61.2.79.154:15002/publications", { params: req.query });
    res.json(response.data);
  } catch (err) {
    console.error("Error fetching publications:", err.message);
    res.status(500).json({ error: "Failed to fetch publications." });
  }
});

app.get("/special-issues", async (req, res) => {
  try {
    const query = { ...req.query, isSpecialIssue: true };
    const response = await axios.get("http://61.2.79.154:15002/publications", { params: query });
    res.json(response.data);
  } catch (err) {
    console.error("Error fetching special issues:", err.message);
    res.status(500).json({ error: "Failed to fetch special issues." });
  }
});

// 4. Delete a publication by ID
app.delete("/publications/:id", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: "Publication ID is required." });
  }

  try {
    const response = await axios.delete(`http://61.2.79.154:15002/publications/${id}`);
    res.json({ message: "Publication deleted successfully.", data: response.data });
  } catch (err) {
    console.error("Error deleting publication:", err.message);
    res.status(500).json({ error: "Failed to delete publication." });
  }
});

app.get("/view-pdf/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const response = await axios.get(`http://61.2.79.154:15002/publications/${id}`, {
      responseType: "arraybuffer",
    });

    const publication = response.data;

    if (!publication || !publication.pdf) {
      return res.status(404).json({ error: "PDF not found." });
    }

    res.setHeader("Content-Type", publication.pdfContentType || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="document.pdf"`);

    res.send(publication.pdf);
  } catch (err) {
    console.error("Error viewing PDF:", err.message);
    res.status(500).json({ error: "Failed to view PDF." });
  }
});

// 5. Add a new publication
app.post("/publications", upload.single("pdf"), async (req, res) => {
  const { year, volume, issue, title, content, author, isSpecialIssue } = req.body;

  if (!year || !volume || !issue || !title || !content || !author || !req.file) {
    return res.status(400).json({ error: "All required fields must be provided, including a PDF." });
  }

  try {
    const response = await axios.post(
      "http://61.2.79.154:15002/publications",
      {
        year,
        volume,
        issue,
        title,
        content,
        author,
        isSpecialIssue: isSpecialIssue !== undefined ? isSpecialIssue : false,
        pdf: req.file.buffer,
        pdfContentType: req.file.mimetype,
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    res.status(201).json({
      message: "Publication added successfully with PDF.",
      data: response.data,
    });
  } catch (err) {
    console.error("Error adding publication:", err.message);
    res.status(500).json({ error: "Failed to add publication." });
  }
});

// Start Server
const startServer = async () => {

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();