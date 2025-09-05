// Enhanced utility functions for better content processing

/**
 * Enhanced function to clean Gemini API responses
 * Removes markdown code blocks and unwanted formatting
 */
function cleanGeminiResponse(rawResponse) {
    let cleaned = rawResponse;
    
    // Remove markdown code block indicators
    cleaned = cleaned.replace(/```html\n?/g, '');
    cleaned = cleaned.replace(/```\n?/g, '');
    
    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();
    
    // Remove any explanatory text before the HTML (common with Gemini)
    const htmlStartIndex = cleaned.indexOf('<div id="lecture_');
    if (htmlStartIndex !== -1) {
        cleaned = cleaned.substring(htmlStartIndex);
    }
    
    // Find the last closing div tag
    const lastDivIndex = cleaned.lastIndexOf('</div>');
    if (lastDivIndex !== -1) {
        cleaned = cleaned.substring(0, lastDivIndex + 6);
    }
    
    // Clean up any double spaces or extra newlines
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
    cleaned = cleaned.replace(/  +/g, ' ');
    
    return cleaned;
}

/**
 * Validate that the generated HTML has proper structure
 */
function validateLectureHTML(html) {
    const issues = [];
    
    // Check for required lecture container
    if (!html.includes('class="lecture-content"')) {
        issues.push('Missing lecture-content container');
    }
    
    // Check for proper ID format
    const idMatch = html.match(/id="lecture_(\d{8}_\d{6})"/);
    if (!idMatch) {
        issues.push('Missing or invalid lecture ID format');
    }
    
    // Check for basic structure
    if (!html.includes('<h1>')) {
        issues.push('Missing main title (h1)');
    }
    
    // Check for math content formatting
    const hasInlineMath = html.includes('\\(') && html.includes('\\)');
    const hasBlockMath = html.includes('\\[') && html.includes('\\]');
    
    if (!hasInlineMath && !hasBlockMath) {
        issues.push('No mathematical content detected - might be missing LaTeX formatting');
    }
    
    return {
        isValid: issues.length === 0,
        issues: issues
    };
}

/**
 * Generate a unique timestamp-based ID for lectures
 */
function generateLectureId() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `lecture_${year}${month}${day}_${hours}${minutes}${seconds}`;
}

/**
 * Extract lecture metadata from HTML content
 */
function extractLectureMetadata(html) {
    const metadata = {};
    
    // Extract ID
    const idMatch = html.match(/id="(lecture_\d{8}_\d{6})"/);
    metadata.id = idMatch ? idMatch[1] : null;
    
    // Extract unit
    const unitMatch = html.match(/data-unit="([^"]+)"/);
    metadata.unit = unitMatch ? unitMatch[1] : 'unit1';
    
    // Extract title
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    metadata.title = titleMatch ? titleMatch[1].trim() : 'Untitled Lecture';
    
    // Count sections
    const h2Matches = html.match(/<h2[^>]*>/g);
    metadata.sectionCount = h2Matches ? h2Matches.length : 0;
    
    // Check for different content types
    metadata.hasExamples = html.includes('class="example"');
    metadata.hasSolutions = html.includes('class="solution"');
    metadata.hasDefinitions = html.includes('class="definition"');
    metadata.hasTheorems = html.includes('class="theorem"');
    metadata.hasMathDisplay = html.includes('class="math-display"');
    
    return metadata;
}

/**
 * Enhanced error handling for API calls
 */
async function safeApiCall(apiFunction, fallbackMessage = "API call failed") {
    try {
        return await apiFunction();
    } catch (error) {
        console.error(`API Error: ${error.message}`);
        
        // Log detailed error information
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        
        throw new Error(`${fallbackMessage}: ${error.message}`);
    }
}

/**
 * Post-process HTML to ensure consistent formatting
 */
function postProcessHTML(html) {
    let processed = html;
    
    // Ensure proper spacing around math displays
    processed = processed.replace(/(<div class="math-display">)/g, '\n$1');
    processed = processed.replace(/(<\/div>)(\s*<div class="math-display">)/g, '$1\n$2');
    
    // Ensure proper spacing around content containers
    const containers = ['example', 'solution', 'definition', 'theorem', 'method', 'formula'];
    containers.forEach(container => {
        const regex = new RegExp(`(<div class="${container}">)`, 'g');
        processed = processed.replace(regex, '\n$1');
    });
    
    // Clean up excessive whitespace
    processed = processed.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    // Ensure proper indentation (basic)
    const lines = processed.split('\n');
    let indentLevel = 0;
    const indentedLines = lines.map(line => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return '';
        
        // Decrease indent for closing tags
        if (trimmedLine.startsWith('</')) {
            indentLevel = Math.max(0, indentLevel - 1);
        }
        
        const indentedLine = '  '.repeat(indentLevel) + trimmedLine;
        
        // Increase indent for opening tags (but not self-closing)
        if (trimmedLine.startsWith('<') && 
            !trimmedLine.startsWith('</') && 
            !trimmedLine.endsWith('/>') &&
            !trimmedLine.includes('</')  // not a complete tag on one line
        ) {
            indentLevel++;
        }
        
        return indentedLine;
    });
    
    return indentedLines.join('\n');
}

/**
 * Create a backup of the lectures file before modifications
 */
function createBackup(filePath) {
    const fs = require('fs');
    const path = require('path');
    
    if (fs.existsSync(filePath)) {
        const backupPath = filePath.replace('.html', `_backup_${Date.now()}.html`);
        fs.copyFileSync(filePath, backupPath);
        
        // Clean up old backups (keep only last 5)
        const directory = path.dirname(filePath);
        const filename = path.basename(filePath, '.html');
        
        const backupFiles = fs.readdirSync(directory)
            .filter(file => file.startsWith(`${filename}_backup_`) && file.endsWith('.html'))
            .sort()
            .reverse();
        
        // Remove old backups (keep only 5 most recent)
        backupFiles.slice(5).forEach(file => {
            fs.unlinkSync(path.join(directory, file));
        });
        
        return backupPath;
    }
    return null;
}

module.exports = {
    cleanGeminiResponse,
    validateLectureHTML,
    generateLectureId,
    extractLectureMetadata,
    safeApiCall,
    postProcessHTML,
    createBackup
};