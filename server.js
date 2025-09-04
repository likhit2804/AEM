const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const cheerio = require("cheerio");
require("dotenv").config();

const { GoogleGenerativeAI } = require("@google/generative-ai");
const authenticateJWT = require("./middleware/authenticateJWT.js");
const authorize = require("./middleware/authorize.js");

const app = express();

// --- Middleware ---
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- Config ---
const SECRET = process.env.JWT_SECRET || "supersecretkey";

// Fake DB
const users = [
    { id: 1, username: "admin", password: bcrypt.hashSync("admin123", 8), role: "admin" },
    { id: 2, username: "user", password: bcrypt.hashSync("user123", 8), role: "user" }
];

// Define units structure for dynamic organization
const UNITS_STRUCTURE = [
    { id: 'unit1', title: 'Unit 1: Differential Equations' },
    { id: 'unit2', title: 'Unit 2: Numerical Solutions to ODEs' },
    { id: 'unit3', title: 'Unit 3: Complex Analysis' },
    { id: 'unit4', title: 'Unit 4: Fourier Series' },
    { id: 'unit5', title: 'Unit 5: Laplace, Fourier and Z Transforms' },
    { id: 'unit6', title: 'Unit 6: Graphs and Combinatorics' }
];

// =============================
// 🔑 AUTH ROUTES
// =============================
app.get("/login", (req, res) => {
    res.render("admin/login.ejs", { error: null });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    if (!user) return res.status(400).render("admin/login.ejs", { error: "User not found" });

    const validPass = bcrypt.compareSync(password, user.password);
    if (!validPass) return res.status(401).render("admin/login.ejs", { error: "Invalid password" });

    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        SECRET,
        { expiresIn: "1h" }
    );

    res.cookie("token", token, { httpOnly: true });
    res.redirect("/admin");
});

app.get("/logout", (req, res) => {
    res.clearCookie("token");
    res.redirect("/login");
});

// =============================
// 🚪 PUBLIC ROUTES
// =============================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static("uploads")); // Serve PDFs for preview
app.get("/", (req, res) => {
    res.render("user/partials/main.ejs" )
});
app.get("/index", (req, res) => {
    // Redirect to the first available lecture or main page
    const lecturesData = getLecturesData();
    const firstLecture = lecturesData.lectures.length > 0 ? lecturesData.lectures[0] : null;
    
    if (firstLecture) {
        res.redirect(`/lectures/${firstLecture.id}`);
    } else {
        res.redirect("/lectures/welcome");
    }
});

// Helper function to get lectures data and organize by units
function getLecturesData() {
    const lecturesFilePath = path.join(__dirname, "content", "lectures.html");
    
    try {
        const htmlContent = fs.readFileSync(lecturesFilePath, "utf-8");
        const $ = cheerio.load(htmlContent);

        // Build lecture list with unit information
        const lectureList = [];
        const unitMap = {};

        // Initialize units
        UNITS_STRUCTURE.forEach(unit => {
            unitMap[unit.id] = {
                ...unit,
                lectures: []
            };
        });

        // Extract lectures and organize by units
        $(".lecture-content").each((i, elem) => {
            const lectureId = $(elem).attr("id");
            const lectureTitle = $(elem).find("h2").first().text() || lectureId;
            const unitId = $(elem).attr("data-unit") || 'unit1'; // Default to unit1 if no unit specified
            
            const lecture = {
                id: lectureId,
                title: lectureTitle,
                unit: unitId
            };

            lectureList.push(lecture);
            
            // Add to appropriate unit
            if (unitMap[unitId]) {
                unitMap[unitId].lectures.push(lecture);
            }
        });

        return {
            lectures: lectureList,
            units: Object.values(unitMap)
        };
    } catch (error) {
        console.error("Could not read lectures file:", error);
        return {
            lectures: [],
            units: UNITS_STRUCTURE.map(unit => ({ ...unit, lectures: [] }))
        };
    }
}

// This is the primary route for viewing lectures.
// It dynamically reads the single HTML file to serve any lecture.
app.get("/lectures/:lectureId", (req, res) => {
    const lectureId = req.params.lectureId;
    const lecturesFilePath = path.join(__dirname, "content", "lectures.html");

    // Get organized lectures data
    const lecturesData = getLecturesData();

    try {
        if (lectureId === 'welcome') {
            // Show welcome page if no lectures exist
            res.render("user/index", {
                units: lecturesData.units,
                currentLectureId: 'welcome',
                currentLectureHtml: "<h2>Welcome to AEM Notes</h2><p>No lectures have been published yet.</p><p>An admin can upload a PDF to generate the content.</p>",
            });
            return;
        }

        const htmlContent = fs.readFileSync(lecturesFilePath, "utf-8");
        const $ = cheerio.load(htmlContent);

        // Find the specific lecture content the user requested
        const lectureElement = $(`#${lectureId}`);
        
        if (lectureElement.length > 0) {
            const currentLectureHtml = lectureElement.html();
            
            res.render("user/index", {
                units: lecturesData.units,
                currentLectureId: lectureId,
                currentLectureHtml: currentLectureHtml,
            });
        } else {
            // If the lecture ID doesn't exist in the file, show a 404
            res.status(404).render("user/index", {
                units: lecturesData.units,
                currentLectureId: null,
                currentLectureHtml: "<h2>Lecture Not Found</h2><p>The requested lecture could not be found.</p>",
            });
        }
    } catch (error) {
        // If the main lectures.html file doesn't exist, show a welcome page.
        console.error("Could not read lectures file:", error);
        res.render("user/index", {
            units: lecturesData.units,
            currentLectureId: 'welcome',
            currentLectureHtml: "<h2>Welcome to AEM Notes</h2><p>No lectures have been published yet.</p><p>An admin can upload a PDF to generate the content.</p>",
        });
    }
});

// =============================
// 🔐 PROTECTED ADMIN ROUTES
// =============================
const adminAuth = [authenticateJWT, authorize("admin")];

app.get("/admin", adminAuth, (req, res) => {
    const lecturesData = getLecturesData();
    res.render("admin/dashboard.ejs", { 
        units: lecturesData.units,
        totalLectures: lecturesData.lectures.length 
    });
});

app.get("/admin/editor", adminAuth, (req, res) => {
    const lecturesFilePath = path.join(__dirname, "content", "lectures.html");
    let fileContent = "";
    try {
        fileContent = fs.readFileSync(lecturesFilePath, "utf-8");
    } catch (error) {
        // File might not exist yet, which is fine. The editor will be empty.
        fileContent = "";
    }
    res.render("admin/editor", { lectureHtmlContent: fileContent });
});

app.post("/admin/save-lectures", adminAuth, (req, res) => {
    const lecturesFilePath = path.join(__dirname, "content", "lectures.html");
    const { content } = req.body;

    try {
        fs.mkdirSync(path.join(__dirname, "content"), { recursive: true });
        fs.writeFileSync(lecturesFilePath, content, "utf-8");
        res.json({ success: true, message: "Lectures saved successfully!" });
    } catch (error) {
        console.error("Error saving lectures:", error);
        res.status(500).json({ success: false, message: "Failed to save content." });
    }
});

// API endpoint to get lectures data for admin dashboard
app.get("/api/lectures", adminAuth, (req, res) => {
    const lecturesData = getLecturesData();
    res.json(lecturesData);
});

// =============================
// 🤖 GEMINI API & FILE UPLOAD
// =============================
if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set in the .env file");
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
const upload = multer({ storage: multer.memoryStorage() });

function cleanGeminiResponse(response) {
    return response
        .replace(/^```html\s*\n?/i, "")
        .replace(/^```\s*\n?/i, "")
        .replace(/\n?```$/i, "")
        .replace(/^`+|`+$/g, "")
        .trim();
}

app.post("/upload", adminAuth, upload.single("pdfFile"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    try {
        const userPrompt = req.body.prompt;
        const lectureUnit = req.body.unit || "unit1"; 
        const lectureTitle = req.body.lectureTitle || req.file.originalname.replace(".pdf", "");

        // ----------------------
        // Stage 1 Prompt: Transcription
        // ----------------------
        const defaultPrompt = `
You are a lecture note converter. Your task is to **transcribe the uploaded PDF content into clean HTML with LaTeX for all mathematical content**. Follow these rules exactly:

1. Transcribe the **entire PDF faithfully**. Do not skip, shorten, or paraphrase.
2. Convert all math into LaTeX (inline → \\(...\\), block → \\[...\\]).
3. Preserve structure: headings, numbering, lists, tables, alignment, examples.
4. Remove all citations ([cite: X], etc.).
5. Wrap the lecture in one container:

<div id="lecture_{UNIQUE_ID}" class="lecture-content" data-unit="${lectureUnit}">
   <h2>${lectureTitle}</h2>
   [CONTENT HERE]
</div>

- {UNIQUE_ID} must be "lecture_YYYYMMDD_HHMMSS".
- Output only this HTML block, nothing else.
`;

        const finalPrompt = userPrompt?.trim() ? userPrompt : defaultPrompt;

        const filePart = {
            inlineData: {
                data: req.file.buffer.toString("base64"),
                mimeType: req.file.mimetype,
            },
        };

        // Stage 1: Generate lecture HTML
        const stage1 = await model.generateContent([finalPrompt, filePart]);
        const rawStage1Html = stage1.response.text();
        const geminiHtml = cleanGeminiResponse(rawStage1Html);

        // ----------------------
        // Stage 2 Prompt: Notion-style formatting
        // ----------------------
     const notionPrompt = `
You are a formatter. Take the following HTML lecture content and improve its **readability in a Notion-style layout**.  

### Rules:
1. Use clean, minimal HTML structure.  
2. Keep a proper hierarchy:  
   - <h1> → lecture title  
   - <h2>, <h3> → subsections  
3. Wrap important notes in <blockquote>.  
4. Use <div class="example"> for examples and <div class="solution"> for solutions.  
5. Use semantic <ul>/<ol> for bullet points or steps.  
6. Math:  
   - Inline math → \\(...\\)  
   - Block math → \\[...\\] inside <div class="math-display">.  
7. Do not remove or paraphrase any content. Only restructure and style.  
8. Wrap the final result in:  
   <div id="lecture_{UNIQUE_ID}" class="lecture-content" data-unit="${lectureUnit}">  
      [FORMATTED CONTENT]  
   </div>  

- {UNIQUE_ID} must be "lecture_YYYYMMDD_HHMMSS".  
- Output only this HTML block. No explanations or extra text.  

CONTENT TO FORMAT:  
${geminiHtml}
`;


        const stage2 = await model.generateContent([notionPrompt]);
        const formattedHtml = cleanGeminiResponse(stage2.response.text());

        // ----------------------
        // Save to lectures.html
        // ----------------------
        const contentDir = path.join(__dirname, "content");
        const lecturesFilePath = path.join(contentDir, "lectures.html");
        fs.mkdirSync(contentDir, { recursive: true });

        let existingContent = "";
        try {
            existingContent = fs.readFileSync(lecturesFilePath, "utf-8");
        } catch {
            existingContent = "";
        }

        const updatedContent = existingContent + "\n" + formattedHtml;
        fs.writeFileSync(lecturesFilePath, updatedContent);

        // Save original PDF
        const tempFilename = Date.now() + "-" + req.file.originalname;
        fs.writeFileSync(path.join("uploads", tempFilename), req.file.buffer);

        // ----------------------
        // Response
        // ----------------------
        res.json({
            success: true,
            pdfUrl: `/uploads/${tempFilename}`,
            rawHtml: geminiHtml,       // Stage 1
            notionHtml: formattedHtml, // Stage 2
            message: "Lecture added successfully in Notion style!"
        });

    } catch (error) {
        console.error("Error processing file with Gemini:", error);
        res.status(500).json({ success: false, error: "Failed to process file with AI." });
    }
});

// =============================
// 🚀 START SERVER
// =============================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));