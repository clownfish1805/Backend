const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { create } = require("xmlbuilder2");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const Publication = require(path.join(__dirname, "model/publicationSchema"));

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ---------- MULTER STORAGE SETUP ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed!"));
  },
});

// ---------- MIDDLEWARE ----------
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// ---------- CONNECT TO DB ----------
const connectDB = async () => {
  try {
    await mongoose.connect(
      "mongodb://admin:ijeae@61.2.79.154:27017/db_publications"
    );
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB Connection Error:", err.message);
    process.exit(1);
  }
};

// ---------- UTILITY FUNCTION ----------
const generateXML = (publication) => {
  return create({ version: "1.0" })
    .ele("publication")
    .ele("title")
    .txt(publication.title)
    .up()
    .ele("author")
    .txt(publication.author)
    .up()
    .ele("volume")
    .txt(publication.volume)
    .up()
    .ele("issue")
    .txt(publication.issue)
    .up()
    .ele("year")
    .txt(publication.year)
    .up()
    .ele("doi")
    .txt(publication.doi || "")
    .up()
    .ele("isSpecialIssue")
    .txt(String(publication.isSpecialIssue))
    .up()
    .ele("content")
    .txt(publication.content)
    .up()
    .ele("id")
    .txt(publication._id.toString())
    .up()
    .end({ prettyPrint: true });
};

// ---------- ROUTES ----------

// View PDF inline
app.get("/view-pdf/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid ID" });

    const publication = await Publication.findById(id);
    if (!publication || !publication.pdf)
      return res.status(404).json({ error: "PDF not found" });

    const pdfPath = path.join(__dirname, publication.pdf);
    if (!fs.existsSync(pdfPath))
      return res.status(404).json({ error: "File missing" });

    res.setHeader(
      "Content-Type",
      publication.pdfContentType || "application/pdf"
    );
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${publication.title || "document"}.pdf"`
    );

    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Failed to load PDF" });
  }
});

// Download PDF
app.get("/download-pdf/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid ID" });

    const publication = await Publication.findById(id);
    if (!publication || !publication.pdf)
      return res.status(404).json({ error: "PDF not found" });

    const pdfPath = path.join(__dirname, publication.pdf);
    if (!fs.existsSync(pdfPath))
      return res.status(404).json({ error: "File missing" });

    res.set("Content-Type", publication.pdfContentType);
    res.set(
      "Content-Disposition",
      `attachment; filename="${publication.title}.pdf"`
    );
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: "Download failed" });
  }
});

// Create publication
app.post("/publications", upload.single("pdf"), async (req, res) => {
  try {
    const { year, volume, issue, title, content, author, doi, isSpecialIssue } =
      req.body;
    if (
      !year ||
      !volume ||
      !issue ||
      !title ||
      !content ||
      !author ||
      !req.file
    )
      return res.status(400).json({ error: "All fields + PDF required" });

    const relativePdfPath = path
      .relative(__dirname, req.file.path)
      .replace(/\\/g, "/");

    const publication = new Publication({
      year,
      volume,
      issue,
      title,
      content,
      author,
      doi,
      isSpecialIssue: isSpecialIssue === "true",
      pdf: relativePdfPath,
      pdfContentType: req.file.mimetype,
    });

    const saved = await publication.save();
    const xml = generateXML(saved);

    fs.writeFileSync(
      path.join(uploadsDir, `publication-${saved._id}.xml`),
      xml,
      "utf-8"
    );

    res.status(201).json({ message: "Publication created", data: saved });
  } catch (err) {
    res.status(500).json({ error: "Creation failed", details: err.message });
  }
});

// Update publication
// Update publication via POST (with file)
app.post("/publications/:id/update", upload.single("pdf"), async (req, res) => {
  try {
    const { id } = req.params;

    // Validate MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid publication ID" });
    }

    // Check if record exists
    const existing = await Publication.findById(id);
    if (!existing) {
      return res.status(404).json({ error: "Publication not found" });
    }

    // Extract fields from req.body
    const { year, volume, issue, title, content, author, doi, isSpecialIssue } = req.body;

    // Update fields
    if (year) existing.year = year;
    if (volume) existing.volume = volume;
    if (issue) existing.issue = issue;
    if (title) existing.title = title;
    if (content) existing.content = content;
    if (author) existing.author = author;
    if (doi) existing.doi = doi;
    if (isSpecialIssue !== undefined) existing.isSpecialIssue = isSpecialIssue === "true";

    // Handle PDF update (if new file uploaded)
    if (req.file) {
      // Delete old file
      if (existing.pdf && fs.existsSync(path.join(__dirname, existing.pdf))) {
        fs.unlinkSync(path.join(__dirname, existing.pdf));
      }

      // Save new file path
      const relativePdfPath = path
        .relative(__dirname, req.file.path)
        .replace(/\\/g, "/");

      existing.pdf = relativePdfPath;
      existing.pdfContentType = req.file.mimetype;
    }

    // Save updated publication
    const updated = await existing.save();

    // Generate updated XML
    const xml = generateXML(updated);
    fs.writeFileSync(
      path.join(uploadsDir, `publication-${id}.xml`),
      xml,
      "utf-8"
    );

    res.status(200).json({ message: "Publication updated", data: updated });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({ error: "Update failed", details: err.message });
  }
});


// Delete publication
app.delete("/publications/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pub = await Publication.findByIdAndDelete(id);
    if (!pub) return res.status(404).json({ error: "Not found" });

    const pdfPath = path.join(__dirname, pub.pdf || "");
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

    const xmlPath = path.join(uploadsDir, `publication-${id}.xml`);
    if (fs.existsSync(xmlPath)) fs.unlinkSync(xmlPath);

    res.json({ message: "Deleted", data: pub });
  } catch (err) {
    res.status(500).json({ error: "Deletion failed", details: err.message });
  }
});

// Get single publication
app.get("/publications/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid ID" });

    const pub = await Publication.findById(id);
    if (!pub) return res.status(404).json({ error: "Not found" });

    res.json(pub);
  } catch (err) {
    res.status(500).json({ error: "Fetch failed", details: err.message });
  }
});

// Filtered publications
app.get("/publications", async (req, res) => {
  const { year, volume, issue, doi, isSpecialIssue } = req.query;
  const query = {};
  if (year) query.year = Number(year);
  if (volume) query.volume = volume;
  if (issue) query.issue = Number(issue);
  if (doi) query.doi = doi;
  if (isSpecialIssue !== undefined)
    query.isSpecialIssue = isSpecialIssue === "true";

  try {
    const pubs = await Publication.find(query);
    res.json(pubs);
  } catch (err) {
    res.status(500).json({ error: "Query failed", details: err.message });
  }
});

// Special issues
app.get("/special-issues", async (req, res) => {
  try {
    const { year, volume, issue } = req.query;
    const query = { isSpecialIssue: true };
    if (year) query.year = Number(year);
    if (volume) query.volume = volume;
    if (issue) query.issue = Number(issue);

    const issues = await Publication.find(query);
    res.json(issues);
  } catch (err) {
    res.status(500).json({ error: "Fetch failed" });
  }
});

// All years
app.get("/years", async (req, res) => {
  try {
    const years = await Publication.distinct("year");
    res.json(years);
  } catch (err) {
    res.status(500).json({ error: "Year fetch failed" });
  }
});

// Volumes for a year
app.get("/volumes", async (req, res) => {
  try {
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: "Year is required" });

    const volumes = await Publication.find({ year: Number(year) }).distinct(
      "volume"
    );
    res.json(volumes);
  } catch (err) {
    res.status(500).json({ error: "Volume fetch failed" });
  }
});

// ---------- START SERVER ----------
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});
