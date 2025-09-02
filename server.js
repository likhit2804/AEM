const express = require('express');
const path = require('path');
const app = express();

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Available lectures
const lectures = [
    'lecture1',
    'lecture2',
    'lecture3',
    'lecture4',
    'lecture5',
    'lecture6',
    'lecture7',
    'lecture8',
    'lecture9',
    "lecture10"
];

// Default route → show Lecture 1
app.get("/", (req, res) => {
  res.render("user/partials/main.ejs", { currentLecture: null });
});
app.get("/index",(req,res)=>{
    res.render("user/index.ejs",{currentLecture:"lecture1"})
})

// Dynamic lecture route
app.get('/lectures/:lectureId', (req, res) => {
    const lectureId = req.params.lectureId;

    if (lectures.includes(lectureId)) {
        console.log(`Rendering lecture: ${lectureId}`);
        res.render('user/index', { currentLecture: lectureId });
    } else {
        res.status(404).send('Lecture not found');
    }
});
app.get("/pdf", (req, res) => {
  res.sendFile(path.join(__dirname, "public/pdf/x.pdf"));
});


require('dotenv').config();


const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Gemini API Initialization
if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set in the .env file");
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }); 



app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const upload = multer({ storage: multer.memoryStorage() });

const cache = {};

// ✅ NEW: Function to clean HTML response from Gemini
function cleanGeminiResponse(response) {
    let cleanedHtml = response;
    
    // Remove markdown code block wrapper if present
    cleanedHtml = cleanedHtml.replace(/^```html\s*\n?/i, '');
    cleanedHtml = cleanedHtml.replace(/^```\s*\n?/i, '');
    cleanedHtml = cleanedHtml.replace(/\n?```$/i, '');
    
    // Remove any remaining backticks at start/end
    cleanedHtml = cleanedHtml.replace(/^`+|`+$/g, '');
    
    // Trim whitespace
    cleanedHtml = cleanedHtml.trim();
    
    return cleanedHtml;
}

app.post('/upload', upload.single('pdfFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    try {
        console.log("Received text from prompt input:", `'${req.body.prompt}'`);

        const userPrompt = req.body.prompt;
        const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        const cacheKey = `${fileHash}-${userPrompt}`;

        if (cache[cacheKey]) {
            console.log("🚀 Serving response from cache!");
            return res.json(cache[cacheKey]);
        }
        
        const defaultPrompt = `
Your task is to convert the PDF content into clean, semantic HTML/EJS that matches this EXACT structure and class naming convention:

REQUIRED STRUCTURE AND CLASS NAMES:
- Main wrapper: <div id="lectureX" class="lecture-content"> (use appropriate lecture number)
- Main titles: <h2>Lecture X: Title</h2>
- Subtitles: <h3>Subtitle</h3>
- Sub-subtitles: <h4>Sub-subtitle</h4>
- Paragraphs: <p>text content</p>
- Math expressions: $math here$ (keep LaTeX format)
- Math displays: <div class="math-display">$math$</div>
- Case boxes: <div class="case-box"><div class="case-title">Title</div><p>content</p></div>
- Examples with collapsible details: <details><summary>Problem statement</summary><div class="solution">solution content</div></details>
- Solution sections: <div class="solution">content</div>
- Lists: <ul><li>items</li></ul>

EXAMPLE OUTPUT FORMAT:
<div id="lecture5" class="lecture-content">
    <h2>Lecture 5: Topic Title</h2>
    <h3>Main Section</h3>
    <p>Paragraph content with $inline math$ expressions.</p>
    <div class="math-display">$display math$</div>
    <h4>Subsection</h4>
    <div class="case-box">
        <div class="case-title">Case Name</div>
        <p>Case description with $math$</p>
    </div>
    <details>
        <summary>Example problem</summary>
        <div class="solution">
            <p>Step-by-step solution</p>
        </div>
    </details>
</div>

STRICT RULES:
1. Output ONLY HTML/EJS code. Do NOT include <html>, <head>, or <body> tags.
2. Do NOT wrap your response in markdown code blocks.
3. Use the EXACT class names shown above.
4. Keep all mathematical expressions in LaTeX format with $ delimiters.
5. Maintain proper hierarchy with h2, h3, h4 tags.
6. Use collapsible <details><summary> for examples and problems.
7. Return ONLY the HTML code, no explanations.

Convert this PDF content into the above HTML structure:`;

        
        let finalPrompt;
        if (userPrompt && userPrompt.trim() !== '') {
            console.log("✅ Using custom prompt provided by user.");
            finalPrompt = `Your primary task is to act as a PDF-to-HTML converter. Analyze the attached PDF file and follow these user instructions carefully: "${userPrompt}"

REQUIRED STRUCTURE AND CLASS NAMES (use these EXACT class names):
- Main wrapper: <div id="lectureX" class="lecture-content">
- Main titles: <h2>Title</h2>
- Subtitles: <h3>Subtitle</h3>
- Sub-subtitles: <h4>Sub-subtitle</h4>
- Math expressions: $math$ (LaTeX format)
- Math displays: <div class="math-display">$math$</div>
- Case boxes: <div class="case-box"><div class="case-title">Title</div><p>content</p></div>
- Examples: <details><summary>Problem</summary><div class="solution">solution</div></details>

IMPORTANT FORMATTING RULES:
- The output must be ONLY the generated HTML code without <html>, <head>, or <body> tags.
- Do NOT wrap your response in markdown code blocks (no \`\`\`html or \`\`\`).
- Use the EXACT class names listed above.
- Keep mathematical expressions in LaTeX format with $ delimiters.
- Return ONLY the HTML code, no explanations or additional text.`;
        } else {
            console.log("ℹ️ No custom prompt provided, using default prompt.");
            finalPrompt = defaultPrompt;
        }

        console.log("🔥 Processing with Gemini API...");

        const filePart = {
            inlineData: {
                data: req.file.buffer.toString("base64"),
                mimeType: req.file.mimetype,
            },
        };

        const result = await model.generateContent([finalPrompt, filePart]);
        const response = result.response;
        const rawGeminiHtml = response.text();
        
        // ✅ NEW: Clean the response to remove markdown formatting
        const geminiHtml = cleanGeminiResponse(rawGeminiHtml);
        
        console.log("📝 Raw Gemini response preview:", rawGeminiHtml.substring(0, 200));
        console.log("✨ Cleaned HTML preview:", geminiHtml.substring(0, 200));
        
        const tempFilename = Date.now() + '-' + req.file.originalname;
        fs.writeFileSync(path.join('uploads', tempFilename), req.file.buffer);
        
        const jsonResponse = {
            success: true,
            pdfUrl: `/uploads/${tempFilename}`,
            geminiHtml: geminiHtml
        };

        cache[cacheKey] = jsonResponse;
        res.json(jsonResponse);

    } catch (error) {
        console.error('Error processing file with Gemini:', error);
        res.status(500).json({ success: false, error: 'Failed to process file with AI.' });
    }
});

app.get("/admin", (req, res) => res.render("a.ejs"))

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));