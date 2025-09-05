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



// Import the utility functions
const { 
    cleanGeminiResponse, 
    validateLectureHTML, 
    generateLectureId, 
    extractLectureMetadata, 
    safeApiCall, 
    postProcessHTML, 
    createBackup 
} = require('./utils/contentProcessing'); // Adjust path as needed

app.post("/upload", adminAuth, upload.single("pdfFile"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    try {
        const userPrompt = req.body.prompt;
        const lectureUnit = req.body.unit || "unit1"; 
        const lectureTitle = req.body.lectureTitle || req.file.originalname.replace(".pdf", "");
        const uniqueId = generateLectureId();

        // ----------------------
        // Stage 1 Prompt: Enhanced Transcription with Educational Understanding
        // ----------------------
        const defaultPrompt = `
You are an expert educational content transcriber specializing in mathematics and engineering. Your task is to convert PDF lecture content into well-structured HTML while maintaining academic rigor and improving pedagogical flow.

**PRIMARY OBJECTIVES:**
1. **Complete Fidelity**: Transcribe ALL content without omission or paraphrasing
2. **Mathematical Accuracy**: Convert all mathematical notation to proper LaTeX
3. **Educational Structure**: Organize content for optimal student comprehension
4. **Logical Flow**: Ensure concepts build systematically

**TRANSCRIPTION STANDARDS:**
• **Mathematical Content**:
  - Inline math: \\(expression\\) for variables and short formulas
  - Block equations: \\[expression\\] for major equations and derivations
  - Number important equations that are referenced later
  - Preserve exact mathematical notation and symbols

• **Content Organization**:
  - Main topics → <h2> with clear, descriptive titles
  - Subtopics → <h3> for major concepts within topics
  - Definitions → <div class="definition"> with formal mathematical definitions
  - Theorems → <div class="theorem"> for important mathematical results
  - Examples → <div class="example"> for worked problems
  - Solutions → <div class="solution"> for step-by-step workings
  - Key formulas → <div class="formula"> for important equations to remember
  - Methods/Procedures → <div class="method"> for systematic approaches

• **Structural Guidelines**:
  - Group related concepts together logically
  - Place definitions before their applications
  - Follow theory with relevant examples
  - Include step-by-step solution processes
  - Maintain the instructor's teaching sequence

• **Academic Standards**:
  - Use precise mathematical language
  - Maintain formal academic tone
  - Include all derivation steps
  - Preserve notation consistency
  - Keep original problem numbering

**HTML OUTPUT STRUCTURE:**
<div id="${uniqueId}" class="lecture-content" data-unit="${lectureUnit}">
   <h1>${lectureTitle}</h1>
   [SYSTEMATICALLY ORGANIZED CONTENT]
</div>

**CRITICAL REQUIREMENTS:**
- Output ONLY the HTML container with content
- NO explanatory text or commentary
- Maintain complete mathematical accuracy
- Ensure logical pedagogical progression
- Use the exact ID provided: ${uniqueId}
`;

        const finalPrompt = userPrompt?.trim() ? userPrompt : defaultPrompt;

        const filePart = {
            inlineData: {
                data: req.file.buffer.toString("base64"),
                mimeType: req.file.mimetype,
            },
        };

        // Stage 1: Generate initial transcription
        console.log("Stage 1: Starting transcription...");
        const stage1Response = await safeApiCall(
            () => model.generateContent([finalPrompt, filePart]),
            "Failed to transcribe PDF content"
        );
        
        const rawStage1Html = stage1Response.response.text();
        const geminiHtml = cleanGeminiResponse(rawStage1Html);

        // Validate Stage 1 output
        const stage1Validation = validateLectureHTML(geminiHtml);
        if (!stage1Validation.isValid) {
            console.warn("Stage 1 validation issues:", stage1Validation.issues);
        }

        // ----------------------
        // Stage 2 Prompt: Advanced Educational Enhancement
        // ----------------------
        const notionPrompt = `
You are an educational content designer specializing in creating optimal learning materials for STEM subjects. Transform the provided HTML into a pedagogically superior format that enhances student comprehension and retention.

**ENHANCEMENT OBJECTIVES:**
1. **Cognitive Load Optimization**: Structure content to minimize extraneous cognitive load
2. **Visual Hierarchy**: Create clear information architecture for easy scanning
3. **Learning Progression**: Ensure smooth knowledge building from basic to complex
4. **Retention Aids**: Highlight key concepts and create memorable presentations

**FORMATTING SPECIFICATIONS:**

• **Hierarchical Enhancement**:
  - <h1>: Lecture title (prominent, centered with thematic styling)
  - <h2>: Major learning objectives/topics with visual separators
  - <h3>: Key concepts within topics (with left border accent)
  - <h4>: Supporting details and sub-concepts

• **Educational Containers** (with auto-generated labels):
  - <div class="definition">: Formal definitions (blue accent, "Definition" label)
  - <div class="theorem">: Mathematical theorems (gradient background, "Theorem" label)
  - <div class="formula">: Key formulas to memorize (bordered, "Key Formula" label)
  - <div class="example">: Worked examples (amber accent, "Example" label)
  - <div class="solution">: Step-by-step solutions (nested, "Solution" label)
  - <div class="method">: Systematic procedures (green accent, "Method" label)
  - <blockquote>: Important notes and insights

• **Mathematical Enhancement**:
  - Inline math: \\(expression\\) with subtle background highlighting
  - Block equations: \\[expression\\] in <div class="math-display">
  - Important equations: <div class="math-display numbered"> for referencing
  - Formula summaries: <div class="formula"> for key equations

• **Learning Aids**:
  - <div class="step">: Individual solution steps for complex problems
  - <ol>: Sequential procedures and algorithms
  - <ul>: Lists of properties, rules, or related concepts
  - <div class="highlight">: Key takeaways and important points

• **Visual Structure**:
  - <hr class="section-divider">: Between major topic sections
  - Clear spacing between different content types
  - Consistent indentation for solution steps
  - Logical grouping of related materials

**PEDAGOGICAL PRINCIPLES:**
• **Scaffolding**: Build complexity gradually
• **Chunking**: Group related information together  
• **Signaling**: Use visual cues to highlight important content
• **Coherence**: Maintain logical flow throughout
• **Worked Examples**: Provide complete solution processes

**CONTENT PRESERVATION RULES:**
- Maintain ALL mathematical content exactly as transcribed
- Preserve the instructor's teaching sequence
- Keep all numerical examples and their solutions
- Maintain notation consistency throughout
- Do not alter any mathematical expressions or equations

**OUTPUT REQUIREMENTS:**
<div id="${uniqueId}" class="lecture-content" data-unit="${lectureUnit}">
   [PEDAGOGICALLY ENHANCED CONTENT]
</div>

**CONSTRAINTS:**
- Use the exact ID provided: ${uniqueId}
- Output ONLY the enhanced HTML container
- NO additional explanations or meta-commentary
- Maintain complete content fidelity while improving structure

CONTENT TO ENHANCE:
${geminiHtml}
`;

        // Stage 2: Educational enhancement
        console.log("Stage 2: Enhancing educational structure...");
        const stage2Response = await safeApiCall(
            () => model.generateContent([notionPrompt]),
            "Failed to enhance educational structure"
        );
        
        const rawStage2Html = stage2Response.response.text();
        const enhancedHtml = cleanGeminiResponse(rawStage2Html);

        // Post-process for consistent formatting
        const finalHtml = postProcessHTML(enhancedHtml);

        // Final validation
        const finalValidation = validateLectureHTML(finalHtml);
        if (!finalValidation.isValid) {
            console.warn("Final validation issues:", finalValidation.issues);
        }

        // Extract metadata for response
        const metadata = extractLectureMetadata(finalHtml);
        console.log("Extracted metadata:", metadata);

        // ----------------------
        // Save to lectures.html with backup
        // ----------------------
        const contentDir = path.join(__dirname, "content");
        const lecturesFilePath = path.join(contentDir, "lectures.html");
        fs.mkdirSync(contentDir, { recursive: true });

        // Create backup before modification
        const backupPath = createBackup(lecturesFilePath);
        if (backupPath) {
            console.log("Backup created:", backupPath);
        }

        // Read existing content
        let existingContent = "";
        try {
            existingContent = fs.readFileSync(lecturesFilePath, "utf-8");
        } catch {
            existingContent = "";
        }

        // Append new content with proper separation
        const separator = existingContent ? "\n\n<!-- =============== NEW LECTURE =============== -->\n\n" : "";
        const updatedContent = existingContent + separator + finalHtml;
        fs.writeFileSync(lecturesFilePath, updatedContent);

        // Save original PDF
        const tempFilename = `${Date.now()}-${req.file.originalname}`;
        const pdfPath = path.join("uploads", tempFilename);
        fs.writeFileSync(pdfPath, req.file.buffer);

        // ----------------------
        // Comprehensive Response
        // ----------------------
        res.json({
            success: true,
            message: "Lecture processed with advanced educational formatting!",
            data: {
                pdfUrl: `/uploads/${tempFilename}`,
                lectureId: uniqueId,
                metadata: metadata,
                processing: {
                    stage1Validation: stage1Validation,
                    finalValidation: finalValidation,
                    backupCreated: !!backupPath
                }
            },
            content: {
                rawTranscription: geminiHtml,
                enhancedHtml: finalHtml
            }
        });

    } catch (error) {
        console.error("Upload processing error:", error);
        
        // Detailed error response
        res.status(500).json({ 
            success: false, 
            error: "Failed to process lecture content",
            details: {
                message: error.message,
                stage: error.stage || "unknown",
                timestamp: new Date().toISOString()
            }
        });
    }
});
// =============================
// 🚀 START SERVER
// =============================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));