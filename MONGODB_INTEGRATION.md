# 🍃 MongoDB Integration Guide
### Persist LexAI Chat Sessions & Resume Where You Left Off

---

## Architecture Overview

```
Browser (LexAI)
    │
    ├── localStorage (current) ── works offline, no setup needed
    │
    └── MongoDB REST API (future) ── cloud sessions, multi-device sync
              │
         GCP Cloud Run FastAPI
              │
         MongoDB Atlas (cloud DB)
```

When you're ready to upgrade from localStorage → MongoDB, **only `storage.js` needs to change** — `app.js` stays the same.

---

## What Gets Stored

| Collection | Data |
|---|---|
| `sessions` | Session ID, title, mode (Summarize/Q&A), created timestamp |
| `messages` | All chat messages (user + AI), timestamps, mode tags |
| `documents` | Extracted document text + file metadata per session |

---

## Step 1 — MongoDB Atlas Setup

Follow [MONGODB_SETUP.md](./MONGODB_SETUP.md) to create:
- ✅ Free Atlas account
- ✅ M0 free cluster `lexai-cluster`
- ✅ Database `lexai_db` with collections: `sessions`, `messages`, `documents`
- ✅ Copy the connection string

---

## Step 2 — Add MongoDB API Endpoints to GCP FastAPI

Add these 4 endpoints to your `legal-api/app.py` on GCP:

```python
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
import os

# ── DB connection (add MONGODB_URI to Cloud Run env vars) ──────
client = AsyncIOMotorClient(os.environ["MONGODB_URI"])
db     = client["lexai_db"]

# ┌──────────────────────────────────────────────────────────────────
# │  SESSIONS
# └──────────────────────────────────────────────────────────────────

@app.get("/api/sessions")
async def get_sessions():
    """Load all sessions (newest first)."""
    sessions = await db.sessions.find({}, {"_id":0}).sort("createdAt", -1).to_list(50)
    return sessions

@app.post("/api/sessions")
async def save_session(session: dict):
    """Upsert a session by session.id."""
    session["updatedAt"] = datetime.utcnow().isoformat()
    await db.sessions.replace_one(
        {"id": session["id"]},
        session,
        upsert=True
    )
    return {"ok": True}

@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    await db.sessions.delete_one({"id": session_id})
    await db.messages.delete_many({"sessionId": session_id})
    await db.documents.delete_many({"sessionId": session_id})
    return {"ok": True}

@app.get("/api/sessions/{session_id}/messages")
async def get_messages(session_id: str):
    """Load messages for a specific session."""
    messages = await db.messages.find({"sessionId": session_id}, {"_id":0}).sort("timestamp", 1).to_list(1000)
    return messages
```

Add `motor` to your `requirements.txt`:
```
motor==3.3.2
```

Redeploy to Cloud Run:
```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/legal-nlp-api
gcloud run deploy legal-nlp-api --image gcr.io/YOUR_PROJECT_ID/legal-nlp-api \
  --set-env-vars MONGODB_URI="mongodb+srv://lexai-admin:PASSWORD@lexai-cluster.xxx.mongodb.net/lexai_db"
```

---

## Step 3 — Update `js/storage.js` to Use MongoDB

Replace the current `storage.js` localStorage implementation with:

```javascript
const Storage = (() => {

  // ── YOUR GCP URL (same as api.js) ──────────────────────────
  const API_BASE = 'https://YOUR_GCP_CLOUD_RUN_URL';
  const ACTIVE_KEY = 'lexai_active_session';

  async function loadSessions() {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      return await res.json();
    } catch (e) {
      console.warn('MongoDB unavailable, using localStorage fallback');
      const raw = localStorage.getItem('lexai_sessions');
      return raw ? JSON.parse(raw) : [];
    }
  }

  async function saveSession(session) {
    // Optimistic local write for instant UI
    const locals = JSON.parse(localStorage.getItem('lexai_sessions') || '[]');
    const i = locals.findIndex(s => s.id === session.id);
    if (i >= 0) locals[i] = session; else locals.unshift(session);
    localStorage.setItem('lexai_sessions', JSON.stringify(locals.slice(0, 50)));

    // Async write to MongoDB (don't await, fire-and-forget)
    fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    }).catch(e => console.warn('MongoDB sync failed:', e));
  }

  async function deleteSession(id) {
    const locals = JSON.parse(localStorage.getItem('lexai_sessions') || '[]');
    localStorage.setItem('lexai_sessions', JSON.stringify(locals.filter(s => s.id !== id)));
    fetch(`${API_BASE}/api/sessions/${id}`, { method: 'DELETE' })
      .catch(e => console.warn('MongoDB delete failed:', e));
  }

  function saveActiveSessionId(id) {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  }

  function loadActiveSessionId() {
    return localStorage.getItem(ACTIVE_KEY);
  }

  function clearAll() {
    localStorage.removeItem('lexai_sessions');
  }

  return { loadSessions, saveSession, deleteSession, saveActiveSessionId, loadActiveSessionId, clearAll };
})();
```

> **Key design:** Uses **optimistic local write** first (instant UI, no lag), then syncs to MongoDB async. If MongoDB is down, localStorage acts as a fallback automatically.

---

## Step 4 — Enable CORS in FastAPI

Add this to your `app.py` so the browser can call the MongoDB endpoints:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # restrict to your domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## What the User Gets After Integration

| Feature | localStorage (now) | MongoDB (after) |
|---|---|---|
| Sessions survive refresh | ✅ | ✅ |
| Continue after closing browser | ✅ | ✅ |
| Sync across devices / browsers | ❌ | ✅ |
| Sessions survive clearing browser data | ❌ | ✅ |
| Multi-user support | ❌ | ✅ |
| Search across sessions | ❌ | ✅ |

---

## Testing Checklist

- [ ] `GET /api/sessions` returns your sessions in Swagger UI (`/docs`)
- [ ] Create a session in LexAI, verify it appears in Atlas → `lexai_db.sessions`
- [ ] Clear browser localStorage → reload → sessions still appear (loaded from MongoDB)
- [ ] Open LexAI on a different device → same sessions visible

---

*This hybrid local + cloud sync pattern gives you offline-first performance with cloud durability.*
