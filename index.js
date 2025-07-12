/* ────────────────────────── SETUP ────────────────────────── */
const express  = require("express");
const cors     = require("cors");
const mongoose = require("mongoose");
const multer   = require("multer");
const path     = require("path");
const fs       = require("fs");
const { create } = require("xmlbuilder2");

const app  = express();
const PORT = process.env.PORT || 8080;

/* ---------- 1. CORS ---------- */
const allowedOrigins = [
  "https://ijeae-upload-pi.vercel.app",
  "https://www.ijeae.com",
];
app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));
app.options("*", cors());

/* ---------- 2. CSP (allow iframe on Vercel) ---------- */
app.use((_, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors 'self' https://ijeae-upload-pi.vercel.app"
  );
  res.removeHeader("X-Frame-Options");
  next();
});

/* ---------- 3. Force HTTPS ---------- */
app.set("trust proxy", true);
app.use((req, res, next) => {
  if (req.secure || req.headers["x-forwarded-proto"] === "https") return next();
  res.redirect(307, `https://${req.headers.host}${req.originalUrl}`);
});

/* ---------- 4. Express JSON ---------- */
app.use(express.json());

/* ---------- 5. DB + uploads ---------- */
const Publication = require(path.join(__dirname, "model/publicationSchema"));
const uploadsDir  = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename:    (_req, file, cb) => cb(null, `${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) =>
    file.mimetype === "application/pdf"
      ? cb(null, true)
      : cb(new Error("Only PDF files are allowed!"))
});

/* ---------- 6. Simple logger ---------- */
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

/* ---------- 7. Mongo ---------- */
async function connectDB() {
  try {
    await mongoose.connect("mongodb://admin:ijeae@61.2.79.154:27017/db_publications");
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB Connection Error:", err.message);
    process.exit(1);
  }
}

/* ---------- 8. XML helper ---------- */
const generateXML = (p) =>
  create({ version: "1.0" })
    .ele("publication")
      .ele("title").txt(p.title).up()
      .ele("author").txt(p.author).up()
      .ele("volume").txt(p.volume).up()
      .ele("issue").txt(p.issue).up()
      .ele("year").txt(p.year).up()
      .ele("doi").txt(p.doi || "").up()
      .ele("isSpecialIssue").txt(String(p.isSpecialIssue)).up()
      .ele("content").txt(p.content).up()
      .ele("id").txt(p._id.toString()).up()
    .end({ prettyPrint: true });

/* ────────────────────────── ROUTES ────────────────────────── */

/* --- VIEW PDF --- */
app.get("/view-pdf/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid ID" });

    const pub = await Publication.findById(id);
    if (!pub || !pub.pdf) return res.status(404).json({ error: "PDF not found" });

    const pdfPath = path.join(__dirname, pub.pdf.replace(/\\/g, "/"));
    if (!fs.existsSync(pdfPath)) return res.status(404).json({ error: "File missing" });

    res.setHeader("Content-Type", pub.pdfContentType || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${pub.title || "document"}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load PDF" });
  }
});

/* --- DOWNLOAD PDF --- */
app.get("/download-pdf/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid ID" });

    const pub = await Publication.findById(id);
    if (!pub || !pub.pdf) return res.status(404).json({ error: "PDF not found" });

    const pdfPath = path.join(__dirname, pub.pdf.replace(/\\/g, "/"));
    if (!fs.existsSync(pdfPath)) return res.status(404).json({ error: "File missing" });

    res.setHeader("Content-Type", pub.pdfContentType);
    res.setHeader("Content-Disposition", `attachment; filename="${pub.title}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: "Download failed" });
  }
});

/* --- CREATE --- */
app.post("/publications", upload.single("pdf"), async (req, res) => {
  try {
    const { year, volume, issue, title, content, author, doi, isSpecialIssue } = req.body;
    if (!year || !volume || !issue || !title || !content || !author || !req.file)
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
    fs.writeFileSync(path.join(uploadsDir, `publication-${saved._id}.xml`), generateXML(saved), "utf-8");

    res.status(201).json({ message: "Publication created", data: saved });
  } catch (err) {
    res.status(500).json({ error: "Creation failed", details: err.message });
  }
});

/* --- UPDATE --- */
app.post("/publications/:id/update", upload.single("pdf"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid publication ID" });

    const existing = await Publication.findById(id);
    if (!existing) return res.status(404).json({ error: "Publication not found" });

    const { year, volume, issue, title, content, author, doi, isSpecialIssue } = req.body;

    if (year)   existing.year   = year;
    if (volume) existing.volume = volume;
    if (issue)  existing.issue  = issue;
    if (title)  existing.title  = title;
    if (content)existing.content= content;
    if (author) existing.author = author;
    if (doi)    existing.doi    = doi;
    if (isSpecialIssue !== undefined)
      existing.isSpecialIssue = isSpecialIssue === "true";

    if (req.file) {
      if (existing.pdf) {
        const oldPath = path.join(__dirname, existing.pdf.replace(/\\/g, "/"));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      const relativePdfPath = path
        .relative(__dirname, req.file.path)
        .replace(/\\/g, "/");

      existing.pdf = relativePdfPath;
      existing.pdfContentType = req.file.mimetype;
    }

    const updated = await existing.save();
    fs.writeFileSync(path.join(uploadsDir, `publication-${id}.xml`), generateXML(updated), "utf-8");

    res.status(200).json({ message: "Publication updated", data: updated });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({ error: "Update failed", details: err.message });
  }
});

/* --- DELETE --- */
app.delete("/publications/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pub = await Publication.findByIdAndDelete(id);
    if (!pub) return res.status(404).json({ error: "Not found" });

    const pdfPath = path.join(__dirname, (pub.pdf || "").replace(/\\/g, "/"));
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

    const xmlPath = path.join(uploadsDir, `publication-${id}.xml`);
    if (fs.existsSync(xmlPath)) fs.unlinkSync(xmlPath);

    res.json({ message: "Deleted", data: pub });
  } catch (err) {
    res.status(500).json({ error: "Deletion failed", details: err.message });
  }
});

/* --- SINGLE PUBLICATION --- */
app.get("/publications/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid ID" });

    const pub = await Publication.findById(id);
    if (!pub) return res.status(404).json({ error: "Not found" });

    res.json(pub);
  } catch (err) {
    res.status(500).json({ error: "Fetch failed", details: err.message });
  }
});

/* --- FILTER / LIST --- */
app.get("/publications", async (req, res) => {
  const { year, volume, issue, doi, isSpecialIssue } = req.query;
  const query = {};
  if (year) query.year = Number(year);
  if (volume) query.volume = volume;
  if (issue) query.issue = Number(issue);
  if (doi) query.doi = doi;
  if (isSpecialIssue !== undefined) query.isSpecialIssue = isSpecialIssue === "true";

  try {
    const pubs = await Publication.find(query);
    res.json(pubs);
  } catch (err) {
    res.status(500).json({ error: "Query failed", details: err.message });
  }
});

/* --- SPECIAL ISSUES --- */
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

/* --- YEARS --- */
app.get("/years", async (_req, res) => {
  try {
    const years = await Publication.distinct("year");
    res.json(years);
  } catch (err) {
    res.status(500).json({ error: "Year fetch failed" });
  }
});

/* --- VOLUMES BY YEAR --- */
app.get("/volumes", async (req, res) => {
  try {
    const { year } = req.query;
    if (!year) return res.status(400).json({ error: "Year is required" });

    const volumes = await Publication.find({ year: Number(year) }).distinct("volume");
    res.json(volumes);
  } catch (err) {
    res.status(500).json({ error: "Volume fetch failed" });
  }
});

/* ---------- START SERVER ---------- */
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀  Server running on port ${PORT}`);
  });
});
