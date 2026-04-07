"""
backend.py  —  LexAI API Server
FastAPI backend: BART summarizer + RoBERTa QA + MongoDB session storage.
Run: legal_venv/bin/python3 backend.py
API: http://localhost:8000
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import pipeline
from motor.motor_asyncio import AsyncIOMotorClient
from typing import Optional, Any
import uvicorn

# ──────────────────────────────────────────────
#  MONGODB SETUP
# ──────────────────────────────────────────────

MONGO_URI = "mongodb+srv://aaditesh23_db_user:hIcxIUk2caAd5YA8@cluster0.rxdu8jm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
DB_NAME   = "lexai_db"

mongo_client   = AsyncIOMotorClient(MONGO_URI)
db             = mongo_client[DB_NAME]
sessions_col   = db["sessions"]
active_col     = db["active_session"]   # single-doc collection

# ──────────────────────────────────────────────
#  LOAD MODELS
# ──────────────────────────────────────────────

print("Loading models... (first run will download model weights)")

summarizer = pipeline(
    "summarization",
    model="facebook/bart-large-cnn",
)

qa_model = pipeline(
    "question-answering",
    model="deepset/roberta-base-squad2",
)

print("✅ Models loaded. Starting server...")

# ──────────────────────────────────────────────
#  APP + CORS
# ──────────────────────────────────────────────

app = FastAPI(title="LexAI API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────
#  SCHEMAS
# ──────────────────────────────────────────────

class SummarizeRequest(BaseModel):
    text: str
    max_length: Optional[int] = 256
    min_length: Optional[int] = 80

class SummarizeResponse(BaseModel):
    summary: str

class QARequest(BaseModel):
    question: str
    context: str

class QAResponse(BaseModel):
    answer: str
    score: float
    start: int
    end: int

class SessionBody(BaseModel):
    session: dict   # full session object from the frontend

class ActiveIdBody(BaseModel):
    id: Optional[str] = None

# ──────────────────────────────────────────────
#  HELPERS
# ──────────────────────────────────────────────

def _strip_id(doc: dict) -> dict:
    """Remove MongoDB _id so JSON serialisation never fails."""
    if doc and "_id" in doc:
        doc = dict(doc)
        del doc["_id"]
    return doc


def chunk_and_summarize(text: str, max_length: int, min_length: int) -> str:
    chunk_size = 3000
    chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
    summaries = []
    for chunk in chunks[:3]:
        chunk_word_count = len(chunk.split())
        effective_max = min(max_length, max(50, chunk_word_count // 2))
        effective_min = min(min_length, effective_max - 10)
        result = summarizer(
            chunk,
            max_length=effective_max,
            min_length=max(10, effective_min),
            do_sample=False,
        )
        summaries.append(result[0]["summary_text"])
    return " ".join(summaries)

# ──────────────────────────────────────────────
#  AI ENDPOINTS
# ──────────────────────────────────────────────

@app.get("/health")
async def health():
    # Quick ping to MongoDB
    try:
        await mongo_client.admin.command("ping")
        mongo_ok = True
    except Exception:
        mongo_ok = False
    return {
        "status": "ok",
        "models": ["facebook/bart-large-cnn", "deepset/roberta-base-squad2"],
        "mongodb": "connected" if mongo_ok else "offline",
    }


@app.post("/summarize", response_model=SummarizeResponse)
def summarize(req: SummarizeRequest):
    text = req.text.strip()
    if not text or len(text) < 10:
        raise HTTPException(status_code=400, detail="Text is too short to summarize.")
    try:
        summary = chunk_and_summarize(text, req.max_length, req.min_length)
        return SummarizeResponse(summary=summary)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summarization failed: {str(e)}")


@app.post("/qa", response_model=QAResponse)
def qa(req: QARequest):
    question = req.question.strip()
    context  = req.context.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    if not context or len(context) < 20:
        raise HTTPException(status_code=400, detail="Context is too short for Q&A.")
    try:
        result = qa_model(question=question, context=context[:4000])
        return QAResponse(
            answer=result["answer"],
            score=float(result["score"]),
            start=int(result["start"]),
            end=int(result["end"]),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"QA failed: {str(e)}")

# ──────────────────────────────────────────────
#  SESSION CRUD ENDPOINTS
# ──────────────────────────────────────────────

@app.get("/sessions")
async def list_sessions():
    """Return all sessions, newest first."""
    cursor = sessions_col.find({}, {"_id": 0}).sort("createdAt", -1).limit(100)
    sessions = [doc async for doc in cursor]
    return {"sessions": sessions}


@app.post("/sessions")
async def upsert_session(body: SessionBody):
    """Create or update a session (upsert by session.id)."""
    s = body.session
    session_id = s.get("id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session.id is required")
    await sessions_col.update_one(
        {"id": session_id},
        {"$set": s},
        upsert=True,
    )
    return {"ok": True}


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Hard-delete a session and clear active pointer if needed."""
    await sessions_col.delete_one({"id": session_id})
    # Clear active pointer if it pointed to this session
    active = await active_col.find_one({"_id": "active"}, {"_id": 0})
    if active and active.get("id") == session_id:
        await active_col.delete_one({"_id": "active"})
    return {"ok": True}


@app.get("/sessions/active")
async def get_active_session_id():
    """Return the last active session ID."""
    doc = await active_col.find_one({"_id": "active"}, {"_id": 0})
    return {"id": doc["id"] if doc else None}


@app.put("/sessions/active")
async def set_active_session_id(body: ActiveIdBody):
    """Set or clear the active session ID."""
    if body.id:
        await active_col.update_one(
            {"_id": "active"},
            {"$set": {"id": body.id}},
            upsert=True,
        )
    else:
        await active_col.delete_one({"_id": "active"})
    return {"ok": True}

# ──────────────────────────────────────────────
#  ENTRY POINT
# ──────────────────────────────────────────────

if __name__ == "__main__":
    print("🚀 LexAI backend running at http://localhost:8000")
    print("   /health            — status check (+ MongoDB ping)")
    print("   /summarize         — POST {text, max_length, min_length}")
    print("   /qa                — POST {question, context}")
    print("   /sessions          — GET all | POST upsert")
    print("   /sessions/{id}     — DELETE")
    print("   /sessions/active   — GET | PUT {id}")
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
