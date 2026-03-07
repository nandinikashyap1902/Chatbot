# ⚡ RAG Assistant

A full-stack AI chatbot that lets you upload documents, images, and websites — then ask questions about them in natural language. Powered by **Groq** (ultra-fast LLM inference), **Pinecone** (vector search), and **Google Gemini** (embeddings).

[![Live Demo](https://img.shields.io/badge/Live%20Demo-chatbotgroq1.netlify.app-brightgreen?logo=netlify)](https://chatbotgroq1.netlify.app/)
![Tech Stack](https://img.shields.io/badge/React-19-61DAFB?logo=react) ![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs) ![Groq](https://img.shields.io/badge/Groq-LLaMA_3.1-orange) ![Pinecone](https://img.shields.io/badge/Pinecone-Vector_DB-blue) ![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)

🔗 **Live:** [https://chatbotgroq1.netlify.app/](https://chatbotgroq1.netlify.app/)

---

## ✨ Features

- 📄 **Upload PDFs, TXT, CSV, Markdown** — ask questions about your documents
- 🖼️ **Image understanding** — upload images and query their content via vision AI
- 🌐 **Website indexing** — paste any URL and ask questions about the page
- ⚡ **Real-time streaming** — responses appear word-by-word like ChatGPT
- 🧠 **Hybrid RAG + General AI** — uses document context when relevant, answers freely otherwise
- 🌙☀️ **Dark / Light mode** — persisted in localStorage
- 🐳 **Docker ready** — one command to run the full stack
- ☁️ **Deployable to Render** — frontend as Static Site, backend as Docker Web Service

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        User Browser                          │
│                  React + Vite (port 5173)                    │
└─────────────────────────┬────────────────────────────────────┘
                          │ HTTP / Streaming
┌─────────────────────────▼────────────────────────────────────┐
│                  Express Backend (port 6001)                  │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  /api/upload│  │/api/upload-  │  │ /api/groq/stream   │  │
│  │  (files)    │  │url (websites)│  │ (chat + RAG)       │  │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬──────────┘  │
│         │                │                    │             │
│    Extract Text      Scrape HTML         1. Embed question   │
│    → Chunk           → Chunk             2. Query Pinecone   │
│    → Embed           → Embed             3. Inject context   │
│    → Pinecone        → Pinecone          4. Call Groq LLM    │
└─────────┬────────────────┬───────────────────┬──────────────┘
          │                │                   │
          ▼                ▼                   ▼
    ┌──────────┐    ┌──────────────┐    ┌──────────────┐
    │ Gemini   │    │   Pinecone   │    │  Groq API    │
    │Embeddings│    │ Vector Store │    │ LLaMA 3.1 8B │
    └──────────┘    └──────────────┘    └──────────────┘
```

### How RAG Works

1. **Upload** — text is extracted, split into 500-word chunks, embedded via Gemini, and stored in Pinecone
2. **Chat** — user question is embedded, Pinecone finds the most similar chunks (cosine similarity)
3. **Threshold check** — only chunks with similarity score ≥ 0.55 are used; otherwise the LLM answers from general knowledge
4. **Response** — context + question sent to Groq LLaMA, answer streamed back in real-time

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7 |
| Backend | Node.js 22, Express |
| LLM | Groq API — LLaMA 3.1 8B Instant |
| Vision AI | Groq — LLaMA 4 Scout (image extraction) |
| Embeddings | Google Gemini (`text-embedding-004`) |
| Vector DB | Pinecone (serverless, cosine similarity) |
| Web Scraping | Cheerio |
| PDF Parsing | pdf-parse |
| Deployment | Docker + nginx, Render |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- API keys for: [Groq](https://console.groq.com), [Pinecone](https://app.pinecone.io), [Google Gemini](https://aistudio.google.com)

### 1. Clone the repo

```bash
git clone https://github.com/nandinikashyap1902/Genai_practice.git
cd Genai_practice
```

### 2. Set up backend

```bash
cd backend
npm install
```

Create `backend/.env`:

```env
GROQ_API_KEY=your_groq_key
GEMINI_API_KEY=your_gemini_key
PINECONE_API_KEY=your_pinecone_key
PINECONE_INDEX=rag-docs
```

### 3. Set up frontend

```bash
cd ../chatbot
npm install
```

### 4. Run locally

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
# Server starts on http://localhost:6001
```

**Terminal 2 — Frontend:**
```bash
cd chatbot
npm run dev
# App opens on http://localhost:5173
```

---

## 🐳 Docker (Run Everything with One Command)

```bash
# From project root
docker compose up --build
```

- Frontend → `http://localhost:3000`
- Backend → `http://localhost:6001`

```bash
# Stop
docker compose down
```

---

## ☁️ Deploy on Render

### Backend (Docker Web Service)

1. New → **Web Service** → connect GitHub repo
2. **Root Directory:** `backend` | **Runtime:** Docker
3. Add environment variables: `GROQ_API_KEY`, `GEMINI_API_KEY`, `PINECONE_API_KEY`
4. Deploy → copy the URL (e.g. `https://rag-backend-xxxx.onrender.com`)

### Frontend (Static Site)

1. New → **Static Site** → same repo
2. **Root Directory:** `chatbot`
3. **Build Command:** `npm install && npm run build`
4. **Publish Directory:** `dist`
5. Add env: `VITE_API_URL` = your backend URL from above
6. Deploy

---

## 📁 Project Structure

```
Genai_practice/
├── backend/
│   ├── server.js              # Main Express server + RAG logic
│   ├── services/
│   │   └── embedding.js       # Gemini embedding API wrapper
│   ├── Dockerfile
│   ├── .dockerignore
│   └── package.json
├── chatbot/
│   ├── src/
│   │   ├── components/
│   │   │   └── Chat.jsx       # Main chat UI component
│   │   ├── styles/
│   │   │   └── chat.css       # All styles + dark/light theme
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── nginx.conf             # nginx config for Docker/production
│   ├── Dockerfile
│   ├── .dockerignore
│   └── package.json
├── docker-compose.yml
└── README.md
```

---

## ⚙️ Environment Variables

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq API key for LLM + vision |
| `GEMINI_API_KEY` | Google Gemini for embeddings |
| `PINECONE_API_KEY` | Pinecone vector database |
| `PINECONE_INDEX` | Index name (default: `rag-docs`) |
| `PORT` | Server port (default: `6001`) |
| `VITE_API_URL` | *(Frontend only)* Backend URL for production |

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/api/upload` | Upload file (PDF, TXT, CSV, MD, images) |
| `POST` | `/api/upload-url` | Index a website by URL |
| `POST` | `/api/groq` | Non-streaming chat |
| `POST` | `/api/groq/stream` | **Streaming chat** (used by frontend) |

---

## 🔑 Key Design Decisions

- **Relevance threshold (0.55):** Pinecone scores below this are ignored — the LLM answers from its own knowledge instead of forcing irrelevant context
- **Short message bypass:** Messages under 10 characters (greetings etc.) skip Pinecone entirely
- **Token management:** Conversation history is trimmed to last 4 turns + 6000 token ceiling — keeps API costs low
- **Overlap chunking:** 500-word chunks with 50-word overlap prevent answers from being missed at chunk boundaries
- **Same embedding model:** Both documents and questions use Gemini `text-embedding-004` — ensures vectors are in the same semantic space for valid cosine comparison

---

## 📄 License

MIT
