/**
 * fileParser.js  —  LexAI Legal AI Platform
 *
 * Handles on-device text extraction from uploaded files.
 *
 * Strategy:
 *   • TXT  → Read as plain text immediately (fast, on-device)
 *   • PDF  → Use PDF.js to extract text on-device (no server needed for text extraction)
 *   • DOCX → Extract on-device using ZIP/XML parsing
 *
 * Why on-device?  Sending raw files to the GCP API for parsing adds latency
 * and upload costs. The GCP API receives only the extracted *text*, keeping
 * the API simple (text in → answer/summary out).
 */

const FileParser = (() => {

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Format file size for display */
    function formatSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /** Strip excessive whitespace / blank lines */
    function cleanText(text) {
        return text
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
    }

    // ── TXT Parser ───────────────────────────────────────────────────────────

    async function parseTXT(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(cleanText(e.target.result));
            reader.onerror = () => reject(new Error('Failed to read text file.'));
            reader.readAsText(file, 'UTF-8');
        });
    }

    // ── PDF Parser (PDF.js) ──────────────────────────────────────────────────

    async function parsePDF(file) {
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF.js library not loaded. Check your internet connection.');
        }

        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let fullText = '';
        const totalPages = pdf.numPages;

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map(item => item.str)
                .join(' ');
            fullText += `\n${pageText}`;
        }

        return cleanText(fullText);
    }

    // ── DOCX Parser ──────────────────────────────────────────────────────────
    // DOCX is a ZIP containing XML. We extract word/document.xml and strip tags.

    async function parseDOCX(file) {
        // Check if JSZip is available (optional dependency)
        if (typeof JSZip === 'undefined') {
            // Fallback: send to GCP for server-side parsing
            console.warn('JSZip not loaded. DOCX will be sent to server for parsing.');
            throw new Error('DOCX_SERVER_PARSE');
        }

        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        const docXml = await zip.file('word/document.xml').async('string');
        // Strip XML tags, clean up whitespace
        const rawText = docXml
            .replace(/<w:t[^>]*>/g, ' ')      // text runs
            .replace(/<w:br[^>]*/g, '\n')     // line breaks
            .replace(/<w:p[^>]*/g, '\n')      // paragraphs
            .replace(/<[^>]+>/g, '')           // all remaining tags
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&apos;/g, "'")
            .replace(/&quot;/g, '"');

        return cleanText(rawText);
    }

    // ── Truncation ───────────────────────────────────────────────────────────
    // Models have token limits. We truncate long documents to be safe.
    // RoBERTa: 512 tokens (~1,800 chars), BART: 1024 tokens (~4,000 chars)
    // We use 12,000 chars as a practical limit (server handles final truncation).

    const MAX_CHARS = 12000;

    function truncateIfNeeded(text) {
        if (text.length <= MAX_CHARS) return { text, truncated: false };
        return {
            text: text.slice(0, MAX_CHARS) + '\n\n[Document truncated for processing…]',
            truncated: true,
            originalLength: text.length
        };
    }

    // ── Main Parse Function ──────────────────────────────────────────────────

    /**
     * Parse a File object and return extracted text + metadata.
     *
     * @param {File} file — The uploaded file
     * @returns {Promise<{text: string, meta: Object, truncated: boolean}>}
     */
    async function parseFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        const sizeStr = formatSize(file.size);

        let rawText = '';

        if (ext === 'txt') {
            rawText = await parseTXT(file);
        } else if (ext === 'pdf') {
            rawText = await parsePDF(file);
        } else if (ext === 'docx') {
            rawText = await parseDOCX(file);
        } else {
            throw new Error(`Unsupported file type: .${ext}. Please upload PDF, DOCX, or TXT.`);
        }

        if (!rawText || rawText.length < 20) {
            throw new Error('Could not extract readable text from this file. The document may be image-based or protected.');
        }

        const { text, truncated, originalLength } = truncateIfNeeded(rawText);

        return {
            text,
            truncated: !!truncated,
            meta: {
                name: file.name,
                size: sizeStr,
                type: ext.toUpperCase(),
                chars: text.length,
                original: originalLength || rawText.length,
                pages: ext === 'pdf' ? '(extracted)' : null,
            }
        };
    }

    return { parseFile, formatSize };
})();
