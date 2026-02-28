import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-embedding-001"
});

export async function getEmbedding(text) {
  const result = await model.embedContent(text);
  return result.embedding.values;
}