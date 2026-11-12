import path from "node:path";
import { config } from "dotenv";

config({ path: path.resolve(process.cwd(), "../backend/.env") });

/** @type {import("next").NextConfig} */
const nextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: [
    "@google/generative-ai",
    "@langchain/community",
    "@langchain/core",
    "@langchain/google-genai",
    "@langchain/pinecone",
    "@langchain/textsplitters",
    "@pinecone-database/pinecone",
    "groq-sdk",
    "pdf-parse",
  ],
  output: "standalone",
};

export default nextConfig;
