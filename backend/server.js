import express from 'express'
import 'dotenv/config'
import cors from 'cors'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

// ── LangChain imports ──────────────────────────────────────────
import { ChatGroq } from '@langchain/groq'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { PineconeStore } from '@langchain/pinecone'
import { Pinecone } from '@pinecone-database/pinecone'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv'
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history'

// ── Groq Vision (images) still needs manual API call ──────────
const require = createRequire(import.meta.url)

const app = express()
app.use(cors({ origin: true, methods: ['GET', 'POST'], credentials: true }))
app.use(express.json())

// ── Multer: temp file storage ──────────────────────────────────
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg', '.webp']
        const ext = path.extname(file.originalname).toLowerCase()
        allowed.includes(ext) ? cb(null, true) : cb(new Error(`File type ${ext} not supported`))
    }
})

// ── STEP 1: LangChain LLM ─────────────────────────────────────
// Replaces: new Groq({ apiKey })
const llm = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: 'llama-3.1-8b-instant',
    temperature: 0.7,
    streaming: true,
})

// ── STEP 2: LangChain Embeddings ──────────────────────────────
// Replaces: getEmbedding() from services/embedding.js
const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GEMINI_API_KEY,
    model: 'text-embedding-004',
})

// ── STEP 3: Pinecone + LangChain VectorStore ──────────────────
// Replaces: manual pineconeIndex.upsert() and pineconeIndex.query()
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY })
const INDEX_NAME = process.env.PINECONE_INDEX || 'rag-docs'
let vectorStore  // PineconeStore — initialized after index is ready

async function initPinecone() {
    const indexList = await pc.listIndexes()
    const exists = indexList.indexes?.some(idx => idx.name === INDEX_NAME)

    if (!exists) {
        console.log(`Creating Pinecone index "${INDEX_NAME}"...`)
        await pc.createIndex({
            name: INDEX_NAME,
            dimension: 768,   // text-embedding-004 outputs 768 dimensions
            metric: 'cosine',
            spec: { serverless: { cloud: 'aws', region: 'us-east-1' } }
        })
        await new Promise(resolve => setTimeout(resolve, 10000))
    }

    // PineconeStore wraps the raw Pinecone index with LangChain's interface
    vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
        pineconeIndex: pc.index(INDEX_NAME),
    })
    console.log(`Pinecone index "${INDEX_NAME}" connected via LangChain`)
}

// ── STEP 4: LangChain Text Splitter ───────────────────────────
// Replaces: your manual chunkText() function
// RecursiveCharacterTextSplitter tries to split at:
//   paragraphs → sentences → words → characters (in that order)
// Never cuts mid-sentence like your word-count splitter could
const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,    // characters (not words)
    chunkOverlap: 150,  // overlap for context continuity
})

// ── STEP 5: Conversation Memory per user ────────────────────
// Replaces: conversations{}, conversationTimestamps{},
//           ensureConversation(), getLastNTurns(), trimToTokenLimit()
// InMemoryChatMessageHistory stores messages per user in memory
const userMemories = {}  // { userId: InMemoryChatMessageHistory }
const MAX_TURNS = 4      // keep last 4 turns (8 messages)

function getMemory(userId) {
    if (!userMemories[userId]) {
        userMemories[userId] = new InMemoryChatMessageHistory()
    }
    return userMemories[userId]
}

async function getTrimmedHistory(userId) {
    const history = await getMemory(userId).getMessages()
    // Keep only last MAX_TURNS * 2 messages (user + assistant per turn)
    return history.slice(-(MAX_TURNS * 2))
}

// ── STEP 6: Image extraction (still manual — no LangChain loader for base64 vision) ──
import Groq from 'groq-sdk'
const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY })

async function extractTextFromImage(filePath, ext) {
    const base64Image = fs.readFileSync(filePath).toString('base64')
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

    const response = await groqClient.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{
            role: 'user',
            content: [
                { type: 'image_url', image_url: { url: `data:${mimeMap[ext]};base64,${base64Image}` } },
                { type: 'text', text: 'Extract ALL text from this image. Describe diagrams, charts or infographics in detail. Return only the extracted text.' }
            ]
        }],
        max_tokens: 2000
    })
    return response.choices[0].message.content
}

// ── Helper: embed and store LangChain Documents in Pinecone ───
// Replaces: embedAndUpsert()
async function embedAndStore(docs, sourceName, sourceType) {
    // Add metadata to each doc
    const docsWithMeta = docs.map((doc, i) => ({
        ...doc,
        metadata: { ...doc.metadata, source: sourceType, filename: sourceName, chunkIndex: i }
    }))
    // LangChain handles embedding + upserting in one call
    await PineconeStore.fromDocuments(docsWithMeta, embeddings, {
        pineconeIndex: pc.index(INDEX_NAME),
    })
    return docsWithMeta.length
}

// ── Helper: get relevant docs with relevance threshold ────────
// Replaces: retrieveRelevantDocs() + buildRagPrompt() threshold logic
const RELEVANCE_THRESHOLD = 0.55

async function getRelevantContext(query) {
    if (query.trim().length < 10) return null  // skip for greetings

    // similaritySearchWithScore returns [Document, score] pairs
    const results = await vectorStore.similaritySearchWithScore(query, 3)
    const good = results.filter(([, score]) => score >= RELEVANCE_THRESHOLD)

    if (good.length === 0) {
        console.log(`[RAG] No relevant docs (best: ${results[0]?.[1]?.toFixed(3) || 'N/A'}) — answering freely`)
        return null
    }

    console.log(`[RAG] Using ${good.length} docs (best score: ${good[0][1].toFixed(3)})`)
    return good.map(([doc]) => doc.pageContent).join('\n')
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.send('RAG API (LangChain) is running'))

// ── File Upload ───────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

        const { path: filePath, originalname } = req.file
        const ext = path.extname(originalname).toLowerCase()
        console.log(`Processing: ${originalname}`)

        let docs = []

        if (ext === '.pdf') {
            // ── LangChain PDFLoader ──────────────────────────
            // Replaces: manual pdf-parse + text extraction
            const loader = new PDFLoader(filePath)
            docs = await loader.load()

        } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
            // Images still use Groq Vision (no LangChain loader for base64)
            const text = await extractTextFromImage(filePath, ext)
            docs = [{ pageContent: text, metadata: { source: filePath } }]

        } else if (['.txt', '.md'].includes(ext)) {
            // Plain text — read and wrap in Document format
            const text = fs.readFileSync(filePath, 'utf-8')
            docs = [{ pageContent: text, metadata: { source: originalname } }]

        } else if (ext === '.csv') {
            // LangChain CSVLoader — each row becomes a Document
            const loader = new CSVLoader(filePath)
            docs = await loader.load()
        }

        if (!docs.length) {
            fs.unlinkSync(filePath)
            return res.status(400).json({ error: 'Could not extract text from file' })
        }

        // ── LangChain Splitter ───────────────────────────────────
        // Replaces: chunkText() — smarter, sentence-aware splitting
        const chunks = await splitter.splitDocuments(docs)
        console.log(`Split into ${chunks.length} chunks`)

        // ── Store in Pinecone via LangChain ─────────────────────
        const count = await embedAndStore(chunks, originalname, 'file')
        fs.unlinkSync(filePath)

        console.log(`Stored ${count} chunks from "${originalname}"`)
        res.json({ success: true, filename: originalname, chunks: count })

    } catch (err) {
        if (req.file?.path) try { fs.unlinkSync(req.file.path) } catch (_) { }
        console.error('Upload error:', err)
        res.status(500).json({ error: err.message || 'Failed to process file' })
    }
})

// ── Website URL Upload ────────────────────────────────────────
app.post('/api/upload-url', async (req, res) => {
    try {
        const { url } = req.body
        if (!url) return res.status(400).json({ error: 'URL is required' })
        try { new URL(url) } catch { return res.status(400).json({ error: 'Invalid URL' }) }

        console.log(`Scraping: ${url}`)

        // ── LangChain CheerioWebBaseLoader ──────────────────
        // Replaces: your entire extractTextFromUrl() function (~65 lines)
        const loader = new CheerioWebBaseLoader(url, {
            selector: 'p, h1, h2, h3, h4, li, article, main',
        })
        const docs = await loader.load()
        if (!docs.length || docs[0].pageContent.trim().length < 50) {
            return res.status(400).json({ error: 'Could not extract meaningful text from URL' })
        }

        const chunks = await splitter.splitDocuments(docs)
        const count = await embedAndStore(chunks, url, 'website')

        console.log(`Indexed ${count} chunks from "${url}"`)
        res.json({ success: true, filename: url, chunks: count })

    } catch (err) {
        console.error('URL upload error:', err)
        res.status(500).json({ error: err.message || 'Failed to process URL' })
    }
})

// ── Streaming Chat (Main Endpoint) ────────────────────────────
app.post('/api/groq/stream', async (req, res) => {
    const { message, userId } = req.body

    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Message is required' })
    if (!userId) return res.status(400).json({ error: 'userId is required' })

    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Content-Type-Options', 'nosniff')

    try {
        // ── Get relevant context from Pinecone ──────────────
        const context = await getRelevantContext(message)

        // ── Build prompt ────────────────────────────────────
        const finalMessage = context
            ? `${context}\n\n${message}`
            : message

        // ── Get/create memory for this user ───────────────────────
        const history = await getTrimmedHistory(userId)

        // ── Build messages array with history ──────────────────────
        const systemMsg = {
            role: 'system',
            content: `You are a friendly, helpful AI assistant. Rules:
1. Answer all questions directly and naturally.
2. NEVER say things like "based on the context", "from the provided documents" or anything similar.
3. Just answer as if you naturally know the information.
4. Be concise and conversational.`
        }

        // Convert LangChain memory messages to Groq format
        const historyMsgs = history.map(msg =>
            msg instanceof HumanMessage
                ? { role: 'user', content: msg.content }
                : { role: 'assistant', content: msg.content }
        )

        const messages = [systemMsg, ...historyMsgs, { role: 'user', content: finalMessage }]

        // ── Stream from Groq ─────────────────────────────────
        const stream = await groqClient.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages,
            stream: true,
            max_tokens: 1500,
            temperature: 0.7
        })

        let fullResponse = ''
        let isClosed = false
        req.on('close', () => { isClosed = true })

        for await (const chunk of stream) {
            if (isClosed) break
            const token = chunk.choices[0]?.delta?.content
            if (token) {
                res.write(token)
                fullResponse += token
            }
        }

        // ── Save to LangChain memory ────────────────────────────
        // Replaces: conversations[userId].push(...)
        const mem = getMemory(userId)
        await mem.addMessage(new HumanMessage(message))
        await mem.addMessage(new AIMessage(fullResponse))

        res.write('[DONE]')
        res.end()

    } catch (err) {
        console.error('Streaming error:', err)
        if (!res.headersSent) {
            res.status(500).json({ error: 'AI service unavailable' })
        } else {
            res.write('\n[ERROR]')
            res.end()
        }
    }
})

// ── Non-streaming endpoint ────────────────────────────────────
app.post('/api/groq', async (req, res) => {
    try {
        const { message, userId } = req.body
        if (!userId) return res.status(400).json({ error: 'userId is required' })
        if (!message?.trim()) return res.status(400).json({ error: 'Message cannot be empty' })

        const context = await getRelevantContext(message)
        const finalMessage = context ? `${context}\n\n${message}` : message

        const history = await getTrimmedHistory(userId)
        const messages = [
            { role: 'system', content: 'You are a friendly, helpful AI assistant. Answer naturally without mentioning context or documents.' },
            ...history.map(msg => msg instanceof HumanMessage
                ? { role: 'user', content: msg.content }
                : { role: 'assistant', content: msg.content }
            ),
            { role: 'user', content: finalMessage }
        ]

        const response = await groqClient.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages,
            max_tokens: 1500
        })

        const result = response.choices[0].message.content
        const mem = getMemory(userId)
        await mem.addMessage(new HumanMessage(message))
        await mem.addMessage(new AIMessage(result))

        res.json({ role: 'assistant', content: result })
    } catch (err) {
        console.error('Error in /api/groq:', err)
        res.status(500).json({ error: 'AI service unavailable' })
    }
})

// ── Start ─────────────────────────────────────────────────────
async function start() {
    try {
        await initPinecone()
        const PORT = process.env.PORT || 6001
        app.listen(PORT, () => console.log(`RAG server (LangChain) started on port ${PORT}`))
    } catch (err) {
        console.error('Failed to start:', err)
        process.exit(1)
    }
}

start()