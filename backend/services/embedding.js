import { GoogleGenerativeAI } from "@google/generative-ai";
import { EMBEDDING_MODEL } from "./embeddingConfig.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: EMBEDDING_MODEL
});

export async function getEmbedding(text) {
  const result = await model.embedContent(text);
  return result.embedding.values;
}