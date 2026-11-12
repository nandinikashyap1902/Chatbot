import assert from "node:assert/strict";
import test from "node:test";
import { getRelevantContext } from "./userScope.js";

const userId = "9b96db10-08e4-4c14-a349-2b5a06ec2112";

function createVectorStore(results) {
  let searchOptions;
  return {
    similaritySearchWithScore: async (...args) => {
      searchOptions = args;
      return results;
    },
    get searchOptions() {
      return searchOptions;
    },
  };
}

test("uses the best user-scoped result for a general question about an uploaded website", async () => {
  const vectorStore = createVectorStore([
    [{ pageContent: "A portfolio for a full stack developer." }, 0.42],
    [{ pageContent: "A less relevant project detail." }, 0.31],
  ]);

  const context = await getRelevantContext(
    "What is this website about?",
    userId,
    vectorStore,
  );

  assert.equal(context, "A portfolio for a full stack developer.");
  assert.deepEqual(vectorStore.searchOptions[2], {
    userId: { $eq: userId },
  });
});

test("uses the best user-scoped result when asked for the developer's name", async () => {
  const vectorStore = createVectorStore([
    [{ pageContent: "Hi, I'm Nandini. Full Stack Developer." }, 0.39],
  ]);

  const context = await getRelevantContext(
    "what this developer name is",
    userId,
    vectorStore,
  );

  assert.equal(context, "Hi, I'm Nandini. Full Stack Developer.");
});

test("uses the best user-scoped result for a general question about an uploaded image", async () => {
  const vectorStore = createVectorStore([
    [{ pageContent: "The image shows a dashboard with three status indicators." }, 0.41],
  ]);

  const context = await getRelevantContext(
    "tell me about this image",
    userId,
    vectorStore,
  );

  assert.equal(context, "The image shows a dashboard with three status indicators.");
});

test("does not bypass the relevance threshold for unrelated questions", async () => {
  const vectorStore = createVectorStore([
    [{ pageContent: "A portfolio for a full stack developer." }, 0.42],
  ]);

  const context = await getRelevantContext(
    "How do I bake a cake?",
    userId,
    vectorStore,
  );

  assert.equal(context, null);
});

test("returns all results above the relevance threshold", async () => {
  const vectorStore = createVectorStore([
    [{ pageContent: "Relevant excerpt one." }, 0.78],
    [{ pageContent: "Relevant excerpt two." }, 0.61],
    [{ pageContent: "Weak excerpt." }, 0.31],
  ]);

  const context = await getRelevantContext(
    "Explain the developer's portfolio projects.",
    userId,
    vectorStore,
  );

  assert.equal(context, "Relevant excerpt one.\nRelevant excerpt two.");
});
