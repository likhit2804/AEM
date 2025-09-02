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
  res.render("partials/main.ejs", { currentLecture: null });
});
app.get("/index",(req,res)=>{
    res.render("index.ejs",{currentLecture:"lecture1"})
})

// Dynamic lecture route
app.get('/lectures/:lectureId', (req, res) => {
    const lectureId = req.params.lectureId;

    if (lectures.includes(lectureId)) {
        console.log(`Rendering lecture: ${lectureId}`);
        res.render('index', { currentLecture: lectureId });
    } else {
        res.status(404).send('Lecture not found');
    }
});
app.get("/pdf", (req, res) => {
  res.sendFile(path.join(__dirname, "public/pdf/x.pdf"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});