import express from 'express'
import Groq from 'groq-sdk'
import 'dotenv/config'
import cors from 'cors'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const pdf = require('pdf-parse')
import { Pinecone } from '@pinecone-database/pinecone'
import { getEmbedding } from './services/embedding.js'
import * as cheerio from 'cheerio'

const app = express()
app.use(cors({
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true
}))
app.use(express.json())

// --- Multer setup for file uploads (now includes images) ---
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${ext} not supported. Use: ${allowed.join(', ')}`));
        }
    }
})

// --- Groq Client ---
const conversations = {};
const conversationTimestamps = {};  // track last activity per user
const client = new Groq({
    apiKey: process.env.GROQ_API_KEY
})

// ==================== TOKEN MANAGEMENT ====================

const MAX_CONTEXT_TOKENS = 6000;   // max tokens sent to Groq
const MAX_TURNS = 4;               // keep last N conversation turns
const MAX_RAG_CONTEXT_CHARS = 3000; // cap RAG context size
const RELEVANCE_THRESHOLD = 0.55;  // min Pinecone score to use RAG context
const CONVERSATION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Rough token estimation (~4 chars per token)
function estimateTokens(messages) {
    return Math.ceil(
        messages.reduce((sum, m) => {
            const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            return sum + content.length;
        }, 0) / 4
    );
}

// Keep only the last N user-assistant turn pairs + system message
function getLastNTurns(messages, nTurns) {
    const system = messages.find(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');

    // Group into turns (user + assistant pairs)
    const turns = [];
    for (let i = 0; i < nonSystem.length; i += 2) {
        turns.push(nonSystem.slice(i, i + 2));
    }

    const recentTurns = turns.slice(-nTurns).flat();
    return system ? [system, ...recentTurns] : recentTurns;
}

// Trim messages until under token ceiling
function trimToTokenLimit(messages, maxTokens) {
    let trimmed = [...messages];

    while (estimateTokens(trimmed) > maxTokens && trimmed.length > 2) {
        const system = trimmed.find(m => m.role === 'system');
        const nonSystem = trimmed.filter(m => m.role !== 'system');
        nonSystem.shift(); // remove oldest non-system message
        trimmed = system ? [system, ...nonSystem] : nonSystem;
    }

    return trimmed;
}

// Ensure conversation exists with system prompt
function ensureConversation(userId) {
    if (!conversations[userId]) {
        conversations[userId] = [
            {
                role: 'system',
                content: `You are a friendly, helpful AI assistant. Rules:
1. For greetings (hi, hello, hey), respond with a short friendly greeting.
2. Answer all questions directly and naturally.
3. NEVER say things like "based on the context", "from the provided documents", "reference information suggests", or anything similar.
4. Just answer as if you naturally know the information.
5. Be concise and conversational.`
            }
        ];
    }
    conversationTimestamps[userId] = Date.now();
    return conversations[userId];
}

// Build optimized messages array for Groq
function buildOptimizedMessages(userId, finalPrompt) {
    let messages = ensureConversation(userId);

    // 1. Keep last N turns
    messages = getLastNTurns(messages, MAX_TURNS);

    // 2. Add new user message
    messages.push({ role: 'user', content: finalPrompt });

    // 3. Enforce token ceiling
    messages = trimToTokenLimit(messages, MAX_CONTEXT_TOKENS);

    // Save trimmed state back (without the new message, we'll add raw version later)
    conversations[userId] = messages.slice(0, -1);

    const tokenCount = estimateTokens(messages);
    console.log(`[${userId.slice(0, 8)}] Messages: ${messages.length}, Est. tokens: ${tokenCount}`);

    return messages;
}

// Cap RAG context to prevent massive prompts
function capContext(contextText, maxChars = MAX_RAG_CONTEXT_CHARS) {
    if (contextText.length <= maxChars) return contextText;
    return contextText.slice(0, maxChars) + '\n[...context truncated]';
}

// Build the final prompt — use RAG only if docs are relevant
function buildRagPrompt(message, relevantDocs) {
    // Skip RAG for very short messages (greetings, single words)
    if (message.trim().length < 10) {
        console.log(`[RAG] Short message (${message.trim().length} chars) — skipping RAG`);
        return message;
    }

    // Filter to only docs above the relevance threshold
    const goodDocs = relevantDocs.filter(d => d.score >= RELEVANCE_THRESHOLD);

    // If no docs are relevant, just return the raw question (general mode)
    if (goodDocs.length === 0) {
        console.log(`[RAG] No relevant docs (best score: ${relevantDocs[0]?.score?.toFixed(3) || 'N/A'}) — answering freely`);
        return message;
    }

    console.log(`[RAG] Using ${goodDocs.length} relevant docs (best score: ${goodDocs[0].score.toFixed(3)})`);
    const context = goodDocs.map(d => d.text).join('\n');
    const cappedContext = capContext(context);

    return `${cappedContext}\n\n${message}`;
}
// Cleanup stale conversations (runs every 30 min)
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const userId in conversationTimestamps) {
        if (now - conversationTimestamps[userId] > CONVERSATION_TTL_MS) {
            delete conversations[userId];
            delete conversationTimestamps[userId];
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} stale conversation(s)`);
    }
}, 30 * 60 * 1000);

// --- Pinecone Setup ---
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const INDEX_NAME = process.env.PINECONE_INDEX || 'rag-docs';
let pineconeIndex;

async function initPinecone() {
    const indexList = await pc.listIndexes();
    const exists = indexList.indexes?.some(idx => idx.name === INDEX_NAME);

    if (!exists) {
        console.log(`Creating Pinecone index "${INDEX_NAME}"...`);
        await pc.createIndex({
            name: INDEX_NAME,
            dimension: 3072,
            metric: 'cosine',
            spec: {
                serverless: {
                    cloud: 'aws',
                    region: 'us-east-1'
                }
            }
        });
        console.log('Waiting for index to be ready...');
        await new Promise(resolve => setTimeout(resolve, 10000));
    }

    pineconeIndex = pc.index(INDEX_NAME);
    console.log(`Pinecone index "${INDEX_NAME}" connected`);
}


// --- Text extraction from files ---
async function extractText(filePath, originalName) {
    const ext = path.extname(originalName).toLowerCase();

    if (ext === '.pdf') {
        const buffer = fs.readFileSync(filePath);
        const data = await pdf(buffer);
        return data.text;
    }

    // Images — use Gemini Vision to extract text
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        return await extractTextFromImage(filePath, ext);
    }

    // .txt, .md, .csv — all plain text
    return fs.readFileSync(filePath, 'utf-8');
}

// --- Image text extraction via Groq Vision (free, no Gemini quota) ---
async function extractTextFromImage(filePath, ext) {
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');

    const mimeMap = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp'
    };

    const response = await client.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeMap[ext] || 'image/png'};base64,${base64Image}`
                        }
                    },
                    {
                        type: 'text',
                        text: 'Extract ALL text from this image. If it contains a diagram, chart, or infographic, describe its content in detail. Return only the extracted text and descriptions, no commentary.'
                    }
                ]
            }
        ],
        max_tokens: 2000
    });

    return response.choices[0].message.content;
}

// --- Website text extraction ---
async function extractTextFromUrl(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; RAGBot/1.0)'
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $('script, style, nav, footer, header, iframe, noscript, svg, form').remove();

    // Extract meaningful text from content elements
    const textParts = [];

    // Get page title
    const title = $('title').text().trim();
    if (title) textParts.push(`Title: ${title}`);

    // Get meta description
    const metaDesc = $('meta[name="description"]').attr('content');
    if (metaDesc) textParts.push(`Description: ${metaDesc}`);

    // Get main content - prioritize article / main / body
    const contentSelectors = ['article', 'main', '[role="main"]', '.content', '#content', 'body'];
    let contentEl = null;

    for (const sel of contentSelectors) {
        const el = $(sel);
        if (el.length && el.text().trim().length > 100) {
            contentEl = el;
            break;
        }
    }

    if (contentEl) {
        contentEl.find('h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote, pre, code').each((_, el) => {
            const text = $(el).text().trim();
            if (text.length > 10) {
                textParts.push(text);
            }
        });
    }

    // Fallback: get all paragraph text from body
    if (textParts.length <= 2) {
        $('p, h1, h2, h3, li').each((_, el) => {
            const text = $(el).text().trim();
            if (text.length > 10) {
                textParts.push(text);
            }
        });
    }

    const fullText = textParts.join('\n\n');
    if (fullText.trim().length < 50) {
        throw new Error('Could not extract meaningful text from this URL');
    }

    return fullText;
}

// --- Text chunking ---
function chunkText(text, chunkSize = 500, overlap = 50) {
    const chunks = [];
    const words = text.split(/\s+/);

    for (let i = 0; i < words.length; i += chunkSize - overlap) {
        const chunk = words.slice(i, i + chunkSize).join(' ');
        if (chunk.trim().length > 20) {
            chunks.push(chunk.trim());
        }
    }

    return chunks;
}

// --- Embed and upsert chunks to Pinecone ---
async function embedAndUpsert(chunks, sourceName, sourceType) {
    const vectors = [];
    for (let i = 0; i < chunks.length; i++) {
        const embedding = await getEmbedding(chunks[i]);
        if (!embedding || embedding.length === 0) continue;
        vectors.push({
            id: `${sourceType}-${sourceName}-chunk-${i}-${Date.now()}`,
            values: Array.from(embedding, Number),
            metadata: {
                text: chunks[i],
                source: sourceType,
                filename: sourceName,
                chunkIndex: i
            }
        });
    }

    // Upsert in batches of 100
    for (let i = 0; i < vectors.length; i += 100) {
        const batch = vectors.slice(i, i + 100);
        await pineconeIndex.upsert({ records: batch });
    }

    return vectors.length;
}

// --- Query Pinecone for relevant docs ---
async function retrieveRelevantDocs(query, topK = 3) {
    const queryEmbedding = await getEmbedding(query);

    const results = await pineconeIndex.query({
        vector: queryEmbedding,
        topK,
        includeMetadata: true
    });

    return results.matches.map(match => ({
        text: match.metadata.text,
        score: match.score,
        source: match.metadata.filename || 'unknown'
    }));
}

// ==================== ROUTES ====================

app.get('/', (req, res) => {
    res.send('RAG API with Pinecone is running')
})

// --- File Upload Endpoint (PDF, TXT, MD, CSV, Images) ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { path: filePath, originalname } = req.file;
        console.log(`Processing file: ${originalname}`);

        // 1. Extract text
        const text = await extractText(filePath, originalname);
        if (!text || text.trim().length === 0) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ error: 'Could not extract text from file' });
        }

        // 2. Chunk the text
        const chunks = chunkText(text);
        console.log(`Created ${chunks.length} chunks from "${originalname}"`);

        // 3. Embed and upsert
        const upsertedCount = await embedAndUpsert(chunks, originalname, 'file');

        // 4. Cleanup temp file
        fs.unlinkSync(filePath);

        console.log(`Uploaded ${upsertedCount} chunks from "${originalname}" to Pinecone`);
        res.json({
            success: true,
            filename: originalname,
            chunks: upsertedCount,
            message: `File "${originalname}" processed: ${upsertedCount} chunks stored`
        });
    } catch (err) {
        if (req.file?.path) {
            try { fs.unlinkSync(req.file.path); } catch (_) { }
        }
        console.error('Upload error:', err);
        res.status(500).json({ error: err.message || 'Failed to process file' });
    }
})

// --- Website URL Upload Endpoint ---
app.post('/api/upload-url', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Basic URL validation
        try {
            new URL(url);
        } catch {
            return res.status(400).json({ error: 'Invalid URL format' });
        }

        console.log(`Scraping website: ${url}`);

        // 1. Extract text from website
        const text = await extractTextFromUrl(url);
        console.log(`Extracted ${text.length} chars from ${url}`);

        // 2. Chunk the text
        const chunks = chunkText(text);
        console.log(`Created ${chunks.length} chunks from URL`);

        // 3. Embed and upsert
        const upsertedCount = await embedAndUpsert(chunks, url, 'website');

        console.log(`Indexed ${upsertedCount} chunks from "${url}"`);
        res.json({
            success: true,
            filename: url,
            chunks: upsertedCount,
            message: `Website indexed: ${upsertedCount} chunks stored`
        });
    } catch (err) {
        console.error('URL upload error:', err);
        res.status(500).json({ error: err.message || 'Failed to process URL' });
    }
})

// --- Non-streaming RAG endpoint ---
app.post('/api/groq', async (req, res) => {
    try {
        const { message, userId } = req.body

        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }
        if (!message || !message.trim()) {
            return res.status(400).json({ error: "Message cannot be empty" });
        }

        // RAG retrieval
        const relevantDocs = await retrieveRelevantDocs(message);
        const finalPrompt = buildRagPrompt(message, relevantDocs);

        // Build token-optimized messages
        const optimizedMessages = buildOptimizedMessages(userId, finalPrompt);

        const response = await client.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: optimizedMessages,
            max_tokens: 1500
        })

        const result = response.choices[0].message.content

        // Store only the raw user message (not the bloated RAG context)
        conversations[userId].push({ role: "user", content: message });
        conversations[userId].push({ role: "assistant", content: result });

        res.json({ role: "assistant", content: result })
    }
    catch (err) {
        console.error("Error in /api/groq:", err);
        res.status(500).json({ error: "AI service unavailable" })
    }
})

// --- Streaming RAG endpoint ---
app.post('/api/groq/stream', async (req, res) => {
    const { message, userId } = req.body;

    if (!message || typeof message !== "string") {
        res.status(400).json({ error: "Message is required" });
        return;
    }
    if (!userId) {
        res.status(400).json({ error: "userId is required" });
        return;
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Content-Type-Options", "nosniff");

    try {
        // RAG retrieval
        const relevantDocs = await retrieveRelevantDocs(message);
        const finalPrompt = buildRagPrompt(message, relevantDocs);

        // Build token-optimized messages
        const optimizedMessages = buildOptimizedMessages(userId, finalPrompt);

        const stream = await client.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: optimizedMessages,
            stream: true,
            max_tokens: 1500,
            temperature: 0.7
        });

        let fullResponse = "";
        let isClosed = false;
        req.on("close", () => {
            isClosed = true;
        });

        for await (const chunk of stream) {
            if (isClosed) break;
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
                res.write(token);
                fullResponse += token;
            }
        }

        // Store only the raw user message
        ensureConversation(userId);
        conversations[userId].push({ role: "user", content: message });
        conversations[userId].push({ role: "assistant", content: fullResponse });

        res.write("[DONE]");
        res.end();
    } catch (err) {
        console.error("Streaming error:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: "AI service unavailable" });
        } else {
            res.write("\n[ERROR]");
            res.end();
        }
    }
})

// --- Initialize and start ---
async function start() {
    try {
        await initPinecone();
        const PORT = process.env.PORT || 6001;
        app.listen(PORT, () => {
            console.log(`RAG server started on port ${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();