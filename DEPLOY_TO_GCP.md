# ☁️ Deploying Fine-Tuned Legal NLP Models to GCP
### `deepset/roberta-legal-qa` + `facebook/bart-legal-summarizer` → REST API on Google Cloud Run

---

> **Why GCP over AWS?** Google Cloud Run is serverless — you only pay when requests come in, no server management, and it scales to zero when idle. Much simpler than AWS SageMaker for a BTech project.

---

## 📋 Prerequisites

| Requirement | Details |
|---|---|
| GCP Account | [console.cloud.google.com](https://console.cloud.google.com) (Free tier: $300 credits) |
| Google Cloud SDK | `brew install google-cloud-sdk` (macOS) |
| Docker Desktop | [docker.com/get-started](https://www.docker.com/get-started/) |
| Python 3.10+ | Already installed |
| Fine-tuned models | `roberta_legal_qa.tar.gz` + `bart_legal_summarizer.tar.gz` (downloaded from Colab) |

---

## 🗂️ Step 0 — Folder Structure

Create this folder structure on your Mac after downloading models from Colab:

```
legal-api/
├── models/
│   ├── roberta-legal-qa-final/       ← extracted from roberta_legal_qa.tar.gz
│   └── bart-legal-summarizer-final/  ← extracted from bart_legal_summarizer.tar.gz
├── app.py                             ← FastAPI server (created in Step 2)
├── requirements.txt                   ← Python dependencies
└── Dockerfile                         ← Container definition
```

**Extract your model archives:**
```bash
mkdir -p legal-api/models
cd legal-api/models
tar -xzf ~/Downloads/roberta_legal_qa.tar.gz
tar -xzf ~/Downloads/bart_legal_summarizer.tar.gz
```

---

## 🔧 Step 1 — Create the FastAPI Server

Create `legal-api/app.py`:

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import pipeline
import torch
import uvicorn
import os

app = FastAPI(
    title="Legal NLP API",
    description="QA and Summarization for Indian Legal Judgments",
    version="1.0.0"
)

# ── Load models on startup ──────────────────────────────────────────────────
device = 0 if torch.cuda.is_available() else -1

print("Loading QA model...")
qa_pipeline = pipeline(
    "question-answering",
    model="./models/roberta-legal-qa-final",
    tokenizer="./models/roberta-legal-qa-final",
    device=device
)

print("Loading Summarization model...")
sum_pipeline = pipeline(
    "summarization",
    model="./models/bart-legal-summarizer-final",
    tokenizer="./models/bart-legal-summarizer-final",
    device=device
)

print("✅ Models loaded and ready!")

# ── Request/Response schemas ────────────────────────────────────────────────
class QARequest(BaseModel):
    question: str
    context: str

class SummarizeRequest(BaseModel):
    text: str
    max_length: int = 256
    min_length: int = 80

class QAResponse(BaseModel):
    answer: str
    score: float
    start: int
    end: int

class SummarizeResponse(BaseModel):
    summary: str

# ── Endpoints ───────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "ok", "message": "Legal NLP API is running"}

@app.get("/health")
def health():
    return {"status": "healthy"}

@app.post("/qa", response_model=QAResponse)
def question_answering(req: QARequest):
    if not req.question or not req.context:
        raise HTTPException(status_code=400, detail="Question and context are required")
    try:
        result = qa_pipeline(question=req.question, context=req.context)
        return QAResponse(
            answer=result["answer"],
            score=round(result["score"], 4),
            start=result["start"],
            end=result["end"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/summarize", response_model=SummarizeResponse)
def summarize(req: SummarizeRequest):
    if not req.text:
        raise HTTPException(status_code=400, detail="Text is required")
    try:
        result = sum_pipeline(
            req.text,
            max_length=req.max_length,
            min_length=req.min_length,
            num_beams=4,
            early_stopping=True
        )
        return SummarizeResponse(summary=result[0]["summary_text"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
```

---

## 📦 Step 2 — Create requirements.txt

Create `legal-api/requirements.txt`:

```txt
fastapi==0.111.0
uvicorn==0.30.1
transformers==4.40.0
torch==2.3.0
sentencepiece==0.1.99
pydantic==2.7.1
```

---

## 🐳 Step 3 — Create the Dockerfile

Create `legal-api/Dockerfile`:

```dockerfile
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app and models
COPY app.py .
COPY models/ ./models/

# Expose port
EXPOSE 8080

# Start server
CMD ["python", "app.py"]
```

---

## ☁️ Step 4 — Set Up GCP Project

Run these commands in your Mac terminal:

```bash
# 1. Install Google Cloud SDK (if not done)
brew install google-cloud-sdk

# 2. Login to GCP
gcloud auth login

# 3. Create a new project (or use existing)
gcloud projects create legal-nlp-api --name="Legal NLP API"
gcloud config set project legal-nlp-api

# 4. Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable artifactregistry.googleapis.com

# 5. Authenticate Docker with GCP
gcloud auth configure-docker
```

---

## 🏗️ Step 5 — Build & Push Docker Image

```bash
# Navigate to your project folder
cd ~/legal-api

# Build the Docker image (this will take ~5-10 minutes the first time)
docker build -t gcr.io/legal-nlp-api/legal-api:v1 .

# Push image to Google Container Registry
docker push gcr.io/legal-nlp-api/legal-api:v1

echo "✅ Image pushed to GCR!"
```

> **Note:** The image will be ~4-6 GB because of PyTorch + model weights. This is normal.

---

## 🚀 Step 6 — Deploy to Cloud Run

```bash
gcloud run deploy legal-nlp-api \
  --image gcr.io/legal-nlp-api/legal-api:v1 \
  --platform managed \
  --region us-central1 \
  --memory 8Gi \
  --cpu 4 \
  --timeout 300 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 3 \
  --allow-unauthenticated \
  --port 8080
```

> After deployment, GCP will print a **Service URL** like:
> `https://legal-nlp-api-xxxxxxxx-uc.a.run.app`

---

## 🧪 Step 7 — Test the Live API

Replace `YOUR_SERVICE_URL` with the URL from the previous step:

**Test QA endpoint:**
```bash
curl -X POST "https://YOUR_SERVICE_URL/qa" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Which court delivered this judgment?",
    "context": "The Supreme Court of India delivered a landmark judgment on the Electoral Bond Scheme..."
  }'
```

**Expected response:**
```json
{
  "answer": "The Supreme Court of India",
  "score": 0.9734,
  "start": 4,
  "end": 29
}
```

**Test Summarization endpoint:**
```bash
curl -X POST "https://YOUR_SERVICE_URL/summarize" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "1. The batch of petitions challenged the constitutional validity of the Electoral Bond Scheme...",
    "max_length": 200,
    "min_length": 60
  }'
```

**Interactive API docs** (auto-generated by FastAPI):
```
https://YOUR_SERVICE_URL/docs
```

---

## 💰 Cost Estimate (GCP Free Tier)

| Resource | Free Tier | Typical Cost |
|---|---|---|
| Cloud Run requests | 2M requests/month free | ~$0 for dev usage |
| Cloud Run CPU | 180,000 vCPU-seconds/month free | ~$0.00002/vCPU-s after |
| Cloud Run Memory | 360,000 GB-seconds/month free | ~$0 for dev usage |
| Container Registry | 0.5 GB free | ~$0.026/GB/month |

**For a BTech project with low traffic: effectively $0/month.**

---

## 🔄 Updating Your Model

When you re-train and want to update the deployed model:

```bash
# 1. Replace model files in legal-api/models/
# 2. Rebuild and push new image with new tag
docker build -t gcr.io/legal-nlp-api/legal-api:v2 .
docker push gcr.io/legal-nlp-api/legal-api:v2

# 3. Deploy new version (zero downtime)
gcloud run deploy legal-nlp-api \
  --image gcr.io/legal-nlp-api/legal-api:v2 \
  --platform managed \
  --region us-central1
```

---

## 🔒 (Optional) Add API Authentication

If you want to secure your API with an API key, add this to `app.py`:

```python
from fastapi.security.api_key import APIKeyHeader
from fastapi import Security, Depends

API_KEY = "your-secret-key-here"  # Store in GCP Secret Manager for production
api_key_header = APIKeyHeader(name="X-API-Key")

def verify_api_key(key: str = Security(api_key_header)):
    if key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API Key")
    return key

# Then add `key: str = Depends(verify_api_key)` to each endpoint
@app.post("/qa", response_model=QAResponse)
def question_answering(req: QARequest, key: str = Depends(verify_api_key)):
    ...
```

---

## 📌 Quick Reference — All Commands

```bash
# 1. Extract models
tar -xzf roberta_legal_qa.tar.gz && tar -xzf bart_legal_summarizer.tar.gz

# 2. Build Docker image
docker build -t gcr.io/legal-nlp-api/legal-api:v1 .

# 3. Push to GCR
docker push gcr.io/legal-nlp-api/legal-api:v1

# 4. Deploy
gcloud run deploy legal-nlp-api --image gcr.io/legal-nlp-api/legal-api:v1 \
  --memory 8Gi --cpu 4 --region us-central1 --allow-unauthenticated

# 5. Get the URL
gcloud run services describe legal-nlp-api --region us-central1 --format='value(status.url)'
```

---

*Generated for BTech Project — Indian Legal Judgment NLP Pipeline*
