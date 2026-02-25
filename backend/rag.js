import express from 'express'
import Groq from 'groq-sdk'
import 'dotenv/config'
import cors from 'cors'
import { getEmbedding } from './RAG/geminiEmbedding.js'
import { cosineSimilarity } from './RAG/similarity.js'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
    res.send('hello world')
    console.log('life survived')
})

const conversations = {};
const client = new Groq({
    apiKey: process.env.GROQ_API_KEY
})

// --- RAG: Documents to embed ---
const documents = [
    "OAuth is an authorization framework used for delegated access.",
    "JWT is a compact token format for secure data transmission.",
    "Node.js runs JavaScript on the server using the V8 engine.",
    "Embeddings convert text into numerical vectors."
];

let docEmbeddings = [];

async function initializeEmbeddings() {
    for (let doc of documents) {
        const embedding = await getEmbedding(doc);
        docEmbeddings.push({
            text: doc,
            embedding
        });
    }
    console.log("Gemini document embeddings initialized");
}

async function retrieveRelevantDocs(query) {
    const queryEmbedding = await getEmbedding(query);

    const scored = docEmbeddings.map(doc => ({
        text: doc.text,
        score: cosineSimilarity(queryEmbedding, doc.embedding)
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, 2);
}

app.post('/api/groq', async (req, res) => {
    try {
        const { message, userId } = req.body

        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }
        if (!message || !message.trim()) {
            return res.status(400).json({ error: "Message cannot be empty" });
        }

        if (!conversations[userId]) {
            conversations[userId] = [
                {
                    role: "system",
                    content: "You are a helpful assistant. If you don't know, say you don't know."
                }
            ];
        }

        if (conversations[userId].length > 21) {
            conversations[userId] = [
                conversations[userId][0], // keep system message
                ...conversations[userId].slice(-20)
            ];
        }

        // RAG: Retrieve relevant docs and build context-aware prompt
        const relevantDocs = await retrieveRelevantDocs(message);
        const context = relevantDocs.map(d => d.text).join("\n");

        const finalPrompt = `Answer the question using ONLY the provided context.

Context:
---
${context}
---

Question:
${message}

If the answer is not in the context, say "I don't know."`;

        // Push the context-enriched prompt as the user message
        conversations[userId].push({
            role: "user",
            content: finalPrompt
        });

        const response = await client.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: conversations[userId]
        })

        const result = response.choices[0].message.content
        conversations[userId].push({ role: "assistant", content: result })

        res.json({ role: "assistant", content: result })
    }
    catch (err) {
        console.error("Error in /api/groq:", err);
        res.status(500).json({ error: "AI service unavailable" })
    }
})

// Initialize embeddings, then start server
initializeEmbeddings().then(() => {
    app.listen(6000, () => {
        console.log('Server started on port 6000')
    })
}).catch(err => {
    console.error("Failed to initialize embeddings:", err);
    process.exit(1);
})