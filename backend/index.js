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
        const MAX_MESSAGES = 12; // good starting range: 10–15

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

function estimateTokens(messages) {
  const text = messages.map(m => m.content).join(" ");
  return Math.ceil(text.length / 4); // rough approximation
}
function getLastNTurns(messages, nTurns) {
  console.log('messages',messages)
  const system = messages.find(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");
console.log('nonsystem',nonSystem)
  const turns = [];
  for (let i = 0; i < nonSystem.length; i += 2) {
    turns.push(nonSystem.slice(i, i + 2));
  }
console.log('turns',turns)
  const recentTurns = turns.slice(-nTurns).flat();
console.log('recenttruns', recentTurns )
  return system ? [system, ...recentTurns] : recentTurns;
}

app.post("/api/groq/stream", async (req, res) => {
    const { message, userId } = req.body;
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
  let messages = conversations[userId];
  // 1️⃣ Keep last 4 turns
  messages = getLastNTurns(messages, 4);
  
// 2️⃣ Enforce token ceiling
  const MAX_CONTEXT_TOKENS = 6000;

  while (estimateTokens(messages) > MAX_CONTEXT_TOKENS) {
  // Remove oldest non-system message
  const system = messages.find(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");

  nonSystem.shift(); // remove oldest

  messages = system ? [system, ...nonSystem] : nonSystem;
}
// Save trimmed result
conversations[userId] = messages;
  // 3️⃣ Now push new user message
conversations[userId].push({
  role: "user",
  content: message
});
  console.log(
  `Messages: ${conversations[userId].length}, Estimated Tokens: ${estimateTokens(conversations[userId])}`
);
//   const systemMessage = messages.find(m => m.role === "system");
//   const nonSystemMessages = messages.filter(m => m.role !== "system"); //hard message cap right way 
//   if (nonSystemMessages.length > MAX_MESSAGES) {                 //taking system message
//     const recent = nonSystemMessages.slice(-(MAX_MESSAGES - 1));
//     conversations[userId] = systemMessage
//         ? [systemMessage, ...recent]
//         : recent;
// }
         
//         conversations[userId].push({
//             role: "user",
//             content: message
//         });
  
// console.log("FINAL MESSAGES SENT TO GROQ:");
//  console.log(JSON.stringify(conversations[userId]));
// console.log("Messages being sent:", messages.length);

  const stream = await client.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: conversations[userId],
    stream: true,
    max_tokens:1500
  });
  let isClosed = false;
req.on("close", () => {
  isClosed = true;
});
  // console.time("generation");
  for await (const chunk of stream) {
  
    if (isClosed) break;
    const token = chunk.choices[0]?.delta?.content;
    if (token) {
      res.write(token);
      // res.flushHeaders?.(); // chatgpt feel
    }
  }
//console.timeEnd("generation");
 res.write("[DONE]\n\n");
  res.end();
});
app.listen(5000,() => {
    console.log('server stared')
})