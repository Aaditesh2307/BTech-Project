/**
 * storage.js  —  Amar Kale & Associates Legal AI Platform
 * Async storage layer: MongoDB Atlas via backend API, with localStorage fallback.
 * Backend: http://localhost:8000  (backend.py)
 */

const Storage = (() => {

    // ── CONFIG ──────────────────────────────────────────────────
    const API_BASE = 'http://localhost:8000';
    const LS_KEY = 'amar_kale_sessions';
    const ACTIVE_KEY = 'amar_kale_active_session';
    const LEGACY_LS_KEY = 'le' + 'xai_sessions';
    const LEGACY_ACTIVE_KEY = 'le' + 'xai_active_session';

    let _mongoAvailable = false;   // set after first health check

    // ── HELPERS ─────────────────────────────────────────────────

    async function _fetch(path, options = {}) {
        const res = await fetch(API_BASE + path, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return res.json();
    }

    // ── LOCAL STORAGE FALLBACKS ──────────────────────────────────

    function _lsRead() {
        try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
        catch {
            try { return JSON.parse(localStorage.getItem(LEGACY_LS_KEY) || '[]'); }
            catch { return []; }
        }
    }

    function _lsWrite(sessions) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(sessions.slice(0, 50))); }
        catch (e) { console.warn('[Storage] localStorage write failed', e); }
    }

    // ── PUBLIC API (all async) ───────────────────────────────────

    /**
     * Load all sessions. Returns array newest-first.
     * Falls back to localStorage if backend is unreachable.
     */
    async function loadSessions() {
        try {
            const data = await _fetch('/sessions');
            _mongoAvailable = true;
            // Mirror to localStorage so offline fallback stays fresh
            _lsWrite(data.sessions);
            return data.sessions;
        } catch (_) {
            console.warn('[Storage] MongoDB unavailable — using localStorage');
            _mongoAvailable = false;
            return _lsRead();
        }
    }

    /**
     * Upsert a session by its id.
     */
    async function saveSession(session) {
        // Always update localStorage immediately for snappy UI
        const sessions = _lsRead();
        const idx = sessions.findIndex(s => s.id === session.id);
        if (idx >= 0) sessions[idx] = session; else sessions.unshift(session);
        _lsWrite(sessions);

        // Async push to MongoDB (fire and forget — don't block UI)
        try {
            await _fetch('/sessions', {
                method: 'POST',
                body: JSON.stringify({ session }),
            });
            _mongoAvailable = true;
        } catch (_) {
            _mongoAvailable = false;
        }
    }

    /**
     * Delete a session by id.
     */
    async function deleteSession(id) {
        // Remove from localStorage immediately
        _lsWrite(_lsRead().filter(s => s.id !== id));

        try {
            await _fetch(`/sessions/${id}`, { method: 'DELETE' });
            _mongoAvailable = true;
        } catch (_) {
            _mongoAvailable = false;
        }
    }

    /**
     * Persist the active session ID.
     */
    async function saveActiveSessionId(id) {
        if (id) localStorage.setItem(ACTIVE_KEY, id);
        else localStorage.removeItem(ACTIVE_KEY);

        try {
            await _fetch('/sessions/active', {
                method: 'PUT',
                body: JSON.stringify({ id: id || null }),
            });
        } catch (_) { /* silent */ }
    }

    /**
     * Get the active session ID (try backend first, then localStorage).
     */
    async function loadActiveSessionId() {
        try {
            const data = await _fetch('/sessions/active');
            if (data.id) {
                localStorage.setItem(ACTIVE_KEY, data.id);
                return data.id;
            }
        } catch (_) { /* silent */ }
        return localStorage.getItem(ACTIVE_KEY) || localStorage.getItem(LEGACY_ACTIVE_KEY);
    }

    function clearAll() {
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(ACTIVE_KEY);
        localStorage.removeItem(LEGACY_LS_KEY);
        localStorage.removeItem(LEGACY_ACTIVE_KEY);
        // (MongoDB data is not cleared — intentional for safety)
    }

    function isAtlasConnected() { return _mongoAvailable; }

    return {
        loadSessions,
        saveSession,
        deleteSession,
        saveActiveSessionId,
        loadActiveSessionId,
        clearAll,
        isAtlasConnected,
    };
})();
