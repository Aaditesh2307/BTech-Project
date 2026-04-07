# 🍃 MongoDB Atlas Setup Guide
### For LexAI Chat History Storage

---

## What You Need to Create in MongoDB Atlas

Go to [cloud.mongodb.com](https://cloud.mongodb.com) and do the following:

---

## Step 1 — Create a Free Account & Project

1. Sign up at **cloud.mongodb.com** (free, no credit card needed)
2. Click **New Project** → name it: `LexAI`
3. Click **Create Project**

---

## Step 2 — Deploy a Free Cluster

1. Click **Create** → **M0 Free Tier**
2. Provider: **AWS** | Region: `us-east-1` (or nearest)
3. Cluster name: `lexai-cluster`
4. Click **Create Deployment**

---

## Step 3 — Create a Database User

1. In the setup wizard → **Username/Password**
2. Username: `lexai-admin`
3. Password: (auto-generate → **copy it**)
4. Role: **Read and Write to Any Database**
5. Click **Create User**

---

## Step 4 — Whitelist Your IP (Network Access)

1. Go to **Security → Network Access → Add IP Address**
2. For development: click **Allow Access from Anywhere** (0.0.0.0/0)
3. For production GCP: add your Cloud Run outbound IP range

---

## Step 5 — Get Your Connection String

1. Click **Connect** on your cluster
2. Choose **Drivers** → Python → version 3.12+
3. Copy the connection string — it looks like:
```
mongodb+srv://lexai-admin:<password>@lexai-cluster.xxxxxx.mongodb.net/?retryWrites=true&w=majority
```
4. Replace `<password>` with your actual password

---

## Step 6 — Database & Collections to Create

Create database: **`lexai_db`**

| Collection | Purpose | Key Fields |
|---|---|---|
| `sessions` | Chat sessions | `_id`, `user_id`, `title`, `mode`, `created_at`, `updated_at` |
| `messages` | Chat messages | `_id`, `session_id`, `role`, `text`, `mode`, `file_name`, `timestamp` |
| `documents` | Parsed document cache | `_id`, `session_id`, `file_name`, `text`, `meta`, `created_at` |

**To create:** In Atlas UI → Browse Collections → Create Database

---

## Step 7 — Add Connection String to GCP Deployment

After getting your connection string, add it as an environment variable in your Cloud Run service:

```bash
gcloud run services update legal-nlp-api \
  --region us-central1 \
  --set-env-vars MONGODB_URI="mongodb+srv://lexai-admin:PASSWORD@lexai-cluster.xxx.mongodb.net/lexai_db"
```

---

## Python FastAPI Integration Snippet (for future use)

Add to your `app.py` on GCP:

```python
from motor.motor_asyncio import AsyncIOMotorClient
import os

# Connect to MongoDB
MONGO_URI = os.environ.get("MONGODB_URI")
client    = AsyncIOMotorClient(MONGO_URI)
db        = client["lexai_db"]

# Collections
sessions_col  = db["sessions"]
messages_col  = db["messages"]
documents_col = db["documents"]

# Install driver:  pip install motor
```

---

## Checklist

- [ ] Account created at cloud.mongodb.com
- [ ] Free M0 cluster created
- [ ] Database user `lexai-admin` created
- [ ] Network access configured
- [ ] Connection string copied and saved securely
- [ ] Database `lexai_db` created with 3 collections
- [ ] Connection string added to GCP Cloud Run env vars

---

*MongoDB Atlas Free Tier: 512 MB storage, no credit card required — sufficient for a BTech project.*
