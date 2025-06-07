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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed!"), false);
  },
});

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

const connectDB = async () => {
  try {
    await mongoose.connect(
      "mongodb://admin:ijeae@61.2.79.154:27017/db_publications"
    );
    console.log("Connected to DB");
  } catch (err) {
    console.error("Database connection error:", err.message);
    process.exit(1);
  }
};

// ------------------- ROUTES -------------------

// Download PDF
app.get("/download-pdf/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid publication ID." });

    const publication = await Publication.findById(id);
    if (!publication || !publication.pdf)
      return res.status(404).json({ error: "PDF not found." });

    const pdfPath = path.join(__dirname, publication.pdf);
    if (!fs.existsSync(pdfPath))
      return res.status(404).json({ error: "PDF file not found on disk." });

    res.set("Content-Type", publication.pdfContentType);
    res.set(
      "Content-Disposition",
      `attachment; filename="${publication.title}.pdf"`
    );
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error("Error downloading PDF:", err.message);
    res.status(500).json({ error: "Failed to download PDF." });
  }
});

// Serve PDFs inline using publication ID
app.get("/view-pdf/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid ID format." });
    }

    // Find the publication by ID
    const publication = await Publication.findById(id);
    if (!publication) {
      return res.status(404).json({ error: "Publication not found." });
    }

    // Check if PDF field exists
    if (!publication.pdf) {
      return res.status(404).json({ error: "PDF path not found in publication." });
    }

    // Build the correct path to the PDF (assumes relative path stored in DB like "uploads/xyz.pdf")
    const pdfPath = path.join(__dirname, publication.pdf);

    // Debug logging (optional)
    console.log("Requested ID:", id);
    console.log("Resolved PDF Path:", pdfPath);

    // Check if file exists
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: "PDF file not found on disk." });
    }

    // Send PDF inline
    res.setHeader("Content-Type", publication.pdfContentType || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${publication.title || "document"}.pdf"`);
     res.send(Buffer.from(publication.pdf.buffer)); // Convert to Buffer if stored as Binary
    // fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error("Error viewing PDF:", err.message);
    res.status(500).json({ error: "Failed to view PDF." });
  }


// Get all years
app.get("/years", async (req, res) => {
  try {
    const years = await Publication.distinct("year");
    res.json(years);
  } catch (err) {
    console.error("Error fetching years:", err.message);
    res.status(500).json({ error: "Failed to fetch years." });
  }
});

// Get volumes for a year
app.get("/volumes", async (req, res) => {
  const { year } = req.query;
  if (!year)
    return res.status(400).json({ error: "Year parameter is required." });

  try {
    const volumes = await Publication.find({ year: Number(year) }).distinct(
      "volume"
    );
    res.json(volumes);
  } catch (err) {
    console.error("Error fetching volumes:", err.message);
    res.status(500).json({ error: "Failed to fetch volumes." });
  }
});

// Get publications (with filters)
app.get("/publications", async (req, res) => {
  const { year, volume, issue, doi, isSpecialIssue } = req.query;

  try {
    const query = {};
    if (year) query.year = Number(year);
    if (volume) query.volume = volume;
    if (issue) query.issue = Number(issue);
    if (doi) query.doi = doi;
    if (isSpecialIssue !== undefined)
      query.isSpecialIssue = isSpecialIssue === "true";

    const publications = await Publication.find(query);
    res.json(publications);
  } catch (err) {
    console.error("Error fetching publications:", err.message);
    res.status(500).json({ error: "Failed to fetch publications." });
  }
});

// Get special issues
app.get("/special-issues", async (req, res) => {
  const { year, volume, issue } = req.query;

  try {
    const query = { isSpecialIssue: true };
    if (year) query.year = Number(year);
    if (volume) query.volume = volume;
    if (issue) query.issue = Number(issue);

    const specialIssues = await Publication.find(query);
    res.json(specialIssues);
  } catch (err) {
    console.error("Error fetching special issues:", err.message);
    res.status(500).json({ error: "Failed to fetch special issues." });
  }
});

// Get single publication
app.get("/publications/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid publication ID." });

    const publication = await Publication.findById(id);
    if (!publication)
      return res.status(404).json({ error: "Publication not found." });

    res.status(200).json(publication);
  } catch (err) {
    console.error("Error fetching publication:", err.message);
    res.status(500).json({ error: "Failed to fetch publication." });
  }
});

// Update publication + regenerate XML
app.put("/publications/:id", async (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;

  try {
    const result = await Publication.findByIdAndUpdate(id, updatedData, {
      new: true,
    });

    if (!result)
      return res.status(404).json({ error: "Publication not found" });

    const xml = create({ version: "1.0" })
      .ele("publication")
      .ele("title")
      .txt(result.title)
      .up()
      .ele("author")
      .txt(result.author)
      .up()
      .ele("volume")
      .txt(result.volume)
      .up()
      .ele("issue")
      .txt(result.issue)
      .up()
      .ele("year")
      .txt(result.year)
      .up()
      .ele("doi")
      .txt(result.doi || "")
      .up()

      .ele("isSpecialIssue")
      .txt(String(result.isSpecialIssue))
      .up()
      .ele("content")
      .txt(result.content)
      .up()
      .ele("id")
      .txt(result._id.toString())
      .up()
      .end({ prettyPrint: true });

    const xmlFilePath = path.join(uploadsDir, `publication-${result._id}.xml`);
    fs.writeFileSync(xmlFilePath, xml, "utf-8");

    res.status(200).json({
      message: "Publication updated and XML regenerated.",
      data: result,
    });
  } catch (err) {
    console.error("Error updating publication:", err.message);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Delete publication
app.delete("/publications/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const deletedPublication = await Publication.findByIdAndDelete(id);
    if (!deletedPublication)
      return res.status(404).json({ error: "Publication not found." });

    if (deletedPublication.pdf && fs.existsSync(deletedPublication.pdf)) {
      fs.unlinkSync(deletedPublication.pdf);
    }
    const xmlFilePath = path.join(uploadsDir, `publication-${id}.xml`);
    if (fs.existsSync(xmlFilePath)) {
      fs.unlinkSync(xmlFilePath);
    }

    res.json({
      message: "Publication deleted successfully.",
      data: deletedPublication,
    });
  } catch (err) {
    console.error("Error deleting publication:", err.message);
    res.status(500).json({ error: "Failed to delete publication." });
  }
});

// Add new publication
app.post("/publications", upload.single("pdf"), async (req, res) => {
  const { year, volume, issue, title, content, author, doi, isSpecialIssue } =
    req.body;

  if (
    !year ||
    !volume ||
    !issue ||
    !title ||
    !content ||
    !author ||
    !doi ||
    !req.file
  ) {
    return res.status(400).json({
      error: "All required fields must be provided, including a PDF.",
    });
  }

  try {
    const newPublication = new Publication({
      year,
      volume,
      issue,
      title,
      content,
      author,
      doi,
      isSpecialIssue: isSpecialIssue === "true",
      pdf: req.file.path,
      pdfContentType: req.file.mimetype,
    });

    const savedPublication = await newPublication.save();

    const xml = create({ version: "1.0" })
      .ele("publication")
      .ele("title")
      .txt(savedPublication.title)
      .up()
      .ele("author")
      .txt(savedPublication.author)
      .up()
      .ele("volume")
      .txt(savedPublication.volume)
      .up()
      .ele("issue")
      .txt(savedPublication.issue)
      .up()
      .ele("year")
      .txt(savedPublication.year)
      .up()
      .ele("doi")
      .txt(savedPublication.doi)
      .up()
      .ele("isSpecialIssue")
      .txt(String(savedPublication.isSpecialIssue))
      .up()
      .ele("content")
      .txt(savedPublication.content)
      .up()
      .ele("id")
      .txt(savedPublication._id.toString())
      .up()
      .end({ prettyPrint: true });

    const xmlFilePath = path.join(
      uploadsDir,
      `publication-${savedPublication._id}.xml`
    );
    fs.writeFileSync(xmlFilePath, xml, "utf-8");

    res.status(201).json({
      message: "Publication saved and XML generated.",
      data: savedPublication,
    });
  } catch (err) {
    console.error("Error saving publication:", err.message);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// ------------------- START SERVER -------------------
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});
