import express from 'express'
import Groq from 'groq-sdk'
import 'dotenv/config'
import cors from 'cors'
import {PROMPTS} from './prompt.config.js'
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
// let Messarr = [{
//             role: 'system', content: 'you are friendly model who helps person and solve their problems.keep it remember when someone ask you question that you unsure about that question say i do not know this always speak softly always try to give examples.do not give answer more than 200 words'
//         },]
// app.post('/api/groq', async(req, res) => {
//     try {
//         const { message, userId } = req.body
        // if (!userId) {
        //     return res.status(400).json({ error: "userId is required" });
        // }
//         if (!message || !message.trim()) {
//             return res.status(400).json({ error: "Message cannot be empty" });
//         }
        // if (!conversations[userId]) {
        //     conversations[userId] = [
        //         {
        //             role: "system",
        //             content: "You are a helpful assistant. If you don’t know, say you don’t know."
        //         }
        //     ];
        // }
        // if (conversations[userId].length > 21) {
        //     conversations[userId] = [
        //         conversations[userId][0], // system
        //         ...conversations[userId].slice(-20)
        //     ];
        // }
        // conversations[userId].push({
        //     role: "user",
        //     content: message
        // });
//         const response = await client.chat.completions.create({
//             model: "llama-3.1-8b-instant",
//             messages: conversations[userId]
//         })
//         const result = response.choices[0].message.content
//         conversations[userId].push({ role: "assistant", content: result })
//         res.json(
//             { role: "assistant", content: result })
//     }
//     catch (err) {
//           res.status(500).josn({error:"Ai service unavailable"})
//       }
// })


app.post("/api/groq/stream", async (req, res) => {
    const { message, userId } = req.body;
    console.log("Incoming body:", req.body);

    if (!message || typeof message !== "string") {
  res.status(400).json({ error: "Message is required" });
  return;
}
if (!userId) {
  res.status(400).json({ error: "userId is required" });
  return;
}

    res.setHeader("Content-Type", "text/plain");
  res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
if (!conversations[userId]) {
  conversations[userId] = [
    {
      role: "system",
      content: PROMPTS.DEFAULT_SYSTEM.content
    }
  ];
        }
        if (conversations[userId].length > 21) {
            conversations[userId] = [
                conversations[userId][0], // system
                ...conversations[userId].slice(-20).filter(m => m.role !== "system")
            ];
        }
        conversations[userId].push({
            role: "user",
            content: message
        });
  
console.log("FINAL MESSAGES SENT TO GROQ:");
console.log(JSON.stringify(conversations[userId], null, 2));

  const stream = await client.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: conversations[userId],
    stream: true
  });

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) {
      res.write(token);
    }
  }

 res.write("[DONE]\n\n");
  res.end();
});
app.listen(5000,() => {
    console.log('server stared')
})