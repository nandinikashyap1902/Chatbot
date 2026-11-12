# RAG Assistant

A full-stack document chatbot built with **Next.js App Router**. It supports
document and image uploads, website indexing, retrieval-augmented chat, and
streaming responses using Groq, Gemini embeddings, and Pinecone.

## Features

- Upload PDF, TXT, Markdown, CSV, and image files.
- Index public HTTPS websites.
- Ask questions with RAG and streamed answers.
- Render assistant responses as Markdown.
- Switch between dark and light themes.
- Replace the previous indexed source on each successful upload.
- Rate-limit Gemini embedding requests and validate vectors before storing.

## Architecture

The Next.js app contains both the React interface and Node.js API routes:

- `src/app/page.jsx` renders the chat UI.
- `src/app/api/upload/route.js` extracts and indexes uploaded files.
- `src/app/api/upload-url/route.js` securely fetches and indexes websites.
- `src/app/api/groq/route.js` handles non-streaming chat.
- `src/app/api/groq/stream/route.js` streams chat responses.
- `src/lib/server/` contains server-only RAG logic and shared service helpers.

The old `backend/` Express app is no longer started by Next.js. Its `.env`
location is still read by the local Next.js config for backward compatibility.

## Run locally

Requirements: Node.js 22.12+ and API credentials for Groq, Google Gemini, and
Pinecone.

```powershell
cd chatbot
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For local development,
Next.js reads the existing `backend/.env` file. If you do not have that file,
copy `chatbot/.env.example` to `chatbot/.env.local` and set the variables.
Never commit files containing real credentials.

## Validate

Run these commands from `chatbot/`:

```powershell
npm test
npm run lint
npm run build
```

## Docker

From the repository root, with `backend/.env` configured:

```powershell
docker compose up --build
```

Then open [http://localhost:3000](http://localhost:3000). Stop it with
`docker compose down`.

## Deploy

Deploy `chatbot/` as a **Node.js web service**, not as a static site. Configure
`GROQ_API_KEY`, `GEMINI_API_KEY`, and `PINECONE_API_KEY` in the hosting
environment. `GROQ_CHAT_MODEL` is optional and defaults to
`openai/gpt-oss-20b`. Image uploads use `GROQ_VISION_MODEL`, which defaults to
`qwen/qwen3.8-27b`. Set it to a vision model enabled for your Groq account.
`PINECONE_INDEX` defaults to `rag-docs`.

## API routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api` | Health check |
| `POST` | `/api/upload` | Upload a file |
| `POST` | `/api/upload-url` | Index a website |
| `POST` | `/api/groq` | Non-streaming chat |
| `POST` | `/api/groq/stream` | Streaming chat |

Uploaded content is scoped by a browser-generated ID. This is not
authentication and must not be used as a security boundary for private data.
Website indexing is limited to public HTTPS hosts and validates DNS results,
redirects, response type, size, and timeout.

## License

MIT
