import express from 'express'
import Groq from 'groq-sdk'
import 'dotenv/config'
import cors from 'cors'
const app = express()
app.use(cors())
app.use(express.json())
app.get('/', (req, res) => {
    res.send('hello world')
    console.log('life survived')
})

app.get("/api/test-stream", (req, res) => {
  // 1️⃣ Tell browser: this is a stream
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const text = "Hello 👋 This is streaming text.";
  let index = 0;

  // 2️⃣ Send one character every 300ms
  const interval = setInterval(() => {
    if (index === text.length) {
      clearInterval(interval);
      res.end(); // 3️⃣ close stream
      return;
    }

    res.write(text[index]); // send ONE character
    index++;
  }, 300);
});

app.listen(5000,() => {
    console.log('server stared')
})