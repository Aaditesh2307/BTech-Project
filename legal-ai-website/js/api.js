/**
 * api.js  —  Amar Kale & Associates Legal AI Platform
 *
 * ╔══════════════════════════════════════════════════════════╗
 * ║  PLACEHOLDER  —  Replace GCP_BASE_URL with your         ║
 * ║  Cloud Run service URL after deployment.                 ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * GCP Cloud Run Endpoints (from your deployment):
 *   POST /qa          →  { question, context }        → { answer, score, start, end }
 *   POST /summarize   →  { text, max_length, min_length } → { summary }
 *   GET  /health      →  { status }
 */

const API = (() => {

    // ══════════════════════════════════════════════════════════
    //  ⚙️  CONFIGURATION  —  EDIT THIS SECTION AFTER DEPLOYMENT
    // ══════════════════════════════════════════════════════════

    const CONFIG = {
        // ✅ Local FastAPI backend (run Test/backend.py first)
        // Switch to your GCP Cloud Run URL after deployment:
        // Example: 'https://legal-nlp-api-xxxxxxxx-uc.a.run.app'
        BASE_URL: 'http://localhost:8000',

        // Optional: add your API key if you enabled authentication
        API_KEY: '',   // e.g. 'my-secret-key'

        // Request timeouts
        TIMEOUT_MS: {
            summarize: 180000,   // 3 min — BART on CPU can be slow
            qa: 60000,           // 1 min — RoBERTa is faster
            health: 5000,
        },

        // Summarization parameters (passed to the BART model)
        SUMMARIZE_PARAMS: {
            max_length: 256,
            min_length: 80,
        },

        // Set to true to use mock responses (no backend needed)
        USE_MOCK: false,
    };

    // ══════════════════════════════════════════════════════════
    //  INTERNAL HELPERS
    // ══════════════════════════════════════════════════════════

    function buildHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (CONFIG.API_KEY) headers['X-API-Key'] = CONFIG.API_KEY;
        return headers;
    }

    async function fetchWithTimeout(url, options, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timer);
            return res;
        } catch (err) {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                throw new Error('Request timed out. The model server may be cold-starting — please try again.');
            }
            throw err;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  MOCK RESPONSES  (used when CONFIG.USE_MOCK = true)
    // ══════════════════════════════════════════════════════════

    function mockDelay(ms = 1800) {
        return new Promise(r => setTimeout(r, ms + Math.random() * 600));
    }

    async function mockSummarize(text) {
        await mockDelay(2200);
        const words = text.trim().split(/\s+/).slice(0, 20).join(' ');
        return {
            summary:
                `[MOCK SUMMARY] This legal document discusses: "${words}..." ` +
                `The court examined the constitutional provisions, evaluated the evidence on record, ` +
                `and delivered a judgment addressing the core legal questions raised. ` +
                `The ruling emphasizes adherence to natural justice and statutory interpretation. ` +
                `\n\n⚠️ This is a mock response. Set USE_MOCK: false and add your GCP URL to get real AI summaries.`
        };
    }

    async function mockQA(question, context) {
        await mockDelay(1400);
        const ctxWords = context.trim().split(/\s+/);
        const snippet = ctxWords.slice(0, 8).join(' ');
        return {
            answer: `[MOCK ANSWER] Based on the document context: "${snippet}..."`,
            score: 0.812,
            start: 0,
            end: 42,
            note: '⚠️ Mock response. Set USE_MOCK: false and provide your GCP URL for real answers.'
        };
    }

    // ══════════════════════════════════════════════════════════
    //  PUBLIC API METHODS
    // ══════════════════════════════════════════════════════════

    /**
     * Check if the GCP model server is reachable.
     * @returns {Promise<'online'|'offline'|'mock'>}
     */
    async function checkHealth() {
        if (CONFIG.USE_MOCK) return 'mock';
        try {
            const res = await fetchWithTimeout(
                `${CONFIG.BASE_URL}/health`,
                { method: 'GET', headers: buildHeaders() },
                CONFIG.TIMEOUT_MS.health
            );
            return res.ok ? 'online' : 'offline';
        } catch {
            return 'offline';
        }
    }

    /**
     * Summarize a legal document text using BART fine-tuned model.
     *
     * @param {string} text  — Full extracted document text
     * @returns {Promise<{summary: string}>}
     */
    async function summarize(text) {
        if (!text || text.trim().length < 10) {
            throw new Error('Text is too short to summarize.');
        }
        if (CONFIG.USE_MOCK) return mockSummarize(text);

        const res = await fetchWithTimeout(
            `${CONFIG.BASE_URL}/summarize`,
            {
                method: 'POST',
                headers: buildHeaders(),
                body: JSON.stringify({
                    text: text.trim(),
                    ...CONFIG.SUMMARIZE_PARAMS,
                }),
            },
            CONFIG.TIMEOUT_MS.summarize
        );

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(
                errorData.detail || `Server error (${res.status}): ${res.statusText}`
            );
        }

        return await res.json();
    }

    /**
     * Answer a question about a legal document using RoBERTa fine-tuned model.
     *
     * @param {string} question — The user's legal question
     * @param {string} context  — The document text to search for the answer
     * @returns {Promise<{answer: string, score: number, start: number, end: number}>}
     */
    async function answerQuestion(question, context) {
        if (!question || question.trim().length < 3) {
            throw new Error('Please enter a valid question.');
        }
        if (!context || context.trim().length < 20) {
            throw new Error('No document context found. Please upload a document first, or paste text.');
        }
        if (CONFIG.USE_MOCK) return mockQA(question, context);

        const res = await fetchWithTimeout(
            `${CONFIG.BASE_URL}/qa`,
            {
                method: 'POST',
                headers: buildHeaders(),
                body: JSON.stringify({
                    question: question.trim(),
                    context: context.trim(),
                }),
            },
            CONFIG.TIMEOUT_MS.qa
        );

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(
                errorData.detail || `Server error (${res.status}): ${res.statusText}`
            );
        }

        return await res.json();
    }

    // ── Expose public interface ────────────────────────────────
    return { checkHealth, summarize, answerQuestion, CONFIG };

})();
