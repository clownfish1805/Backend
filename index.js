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

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
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

// Download PDF
app.get("/download-pdf/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const publication = await Publication.findById(id);
    if (!publication || !publication.pdf)
      return res.status(404).json({ error: "PDF not found." });

    res.set("Content-Type", publication.pdfContentType);
    res.set(
      "Content-Disposition",
      `attachment; filename="${publication.title}.pdf"`
    );
    res.send(publication.pdf);
  } catch (err) {
    console.error("Error downloading PDF:", err.message);
    res.status(500).json({ error: "Failed to download PDF." });
  }
});

// Fetch distinct years
app.get("/years", async (req, res) => {
  try {
    const years = await Publication.distinct("year");
    res.json(years);
  } catch (err) {
    console.error("Error fetching years:", err.message);
    res.status(500).json({ error: "Failed to fetch years." });
  }
});

// Fetch volumes
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

// Fetch publications
app.get("/publications", async (req, res) => {
  const { year, volume, issue, isSpecialIssue } = req.query;

  try {
    const query = {};
    if (year) query.year = Number(year);
    if (volume) query.volume = volume;
    if (issue) query.issue = Number(issue);
    if (isSpecialIssue !== undefined)
      query.isSpecialIssue = isSpecialIssue === "true";

    const publications = await Publication.find(query);
    res.json(publications);
  } catch (err) {
    console.error("Error fetching publications:", err.message);
    res.status(500).json({ error: "Failed to fetch publications." });
  }
});

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

// Delete publication
app.delete("/publications/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const deletedPublication = await Publication.findByIdAndDelete(id);
    if (!deletedPublication)
      return res.status(404).json({ error: "Publication not found." });

    res.json({
      message: "Publication deleted successfully.",
      data: deletedPublication,
    });
  } catch (err) {
    console.error("Error deleting publication:", err.message);
    res.status(500).json({ error: "Failed to delete publication." });
  }
});

// View PDF
app.get("/view-pdf/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid ID format." });

    const publication = await Publication.findById(id);
    if (!publication || !publication.pdf)
      return res.status(404).json({ error: "PDF not found." });

    const pdfPath = path.join(__dirname, publication.pdf);
    if (!fs.existsSync(pdfPath))
      return res.status(404).json({ error: "PDF file not found on disk." });

    res.setHeader(
      "Content-Type",
      publication.pdfContentType || "application/pdf"
    );
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${publication.title}.pdf"`
    );
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);
  } catch (err) {
    console.error("Error viewing PDF:", err.message);
    res.status(500).json({ error: "Failed to view PDF." });
  }
});

// Prefill
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

// 7.Update
app.put("/publications/:id", async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid publication ID." });
  }

  const updatedData = req.body;

  // Log for debugging
  console.log("Update request received for ID:", id);
  console.log("Updated data:", updatedData);

  try {
    const result = await Publication.findByIdAndUpdate(id, updatedData, {
      new: true,
      runValidators: true,
    });
    if (!result)
      return res.status(404).json({ error: "Publication not found" });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Add publication
app.post("/publications", upload.single("pdf"), async (req, res) => {
  const { year, volume, issue, title, content, author, isSpecialIssue } =
    req.body;

  if (
    !year ||
    !volume ||
    !issue ||
    !title ||
    !content ||
    !author ||
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
      isSpecialIssue: isSpecialIssue !== undefined ? isSpecialIssue : false,
      pdf: req.file.path,
      pdfContentType: req.file.mimetype,
    });

    const savedPublication = await newPublication.save();

    const xml = create({ version: "1.0" })
      .ele("publication")
      .ele("title")
      .txt(title)
      .up()
      .ele("author")
      .txt(author)
      .up()
      .ele("volume")
      .txt(volume)
      .up()
      .ele("issue")
      .txt(issue)
      .up()
      .ele("year")
      .txt(year)
      .up()
      .ele("isSpecialIssue")
      .txt(String(isSpecialIssue))
      .up()
      .ele("content")
      .txt(content)
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
      message: "Publication added successfully with PDF and XML created.",
      data: savedPublication,
    });
  } catch (err) {
    console.error("Error adding publication:", err);
    res
      .status(500)
      .json({ error: "Failed to add publication.", details: err.message });
  }
});

// Start server
const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
};

startServer();
