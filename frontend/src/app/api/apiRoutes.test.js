import assert from "node:assert/strict";
import test from "node:test";
import { GET as health } from "./route.js";
import { POST as upload } from "./upload/route.js";
import { POST as uploadUrl } from "./upload-url/route.js";
import { POST as chat } from "./groq/route.js";
import { POST as streamChat } from "./groq/stream/route.js";

test("Next.js health route identifies the API", async () => {
  const response = health();
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Next\.js/);
});

test("upload route rejects requests without a file", async () => {
  const response = await upload(new Request("http://localhost/api/upload", {
    method: "POST",
    body: new FormData(),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "No file uploaded" });
});

test("JSON API routes report malformed request bodies as client errors", async () => {
  const request = () => new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });

  for (const handler of [uploadUrl, chat, streamChat]) {
    const response = await handler(request());
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid JSON request body" });
  }
});

test("stream route returns a terminal error marker for invalid chat requests", async () => {
  const response = await streamChat(new Request("http://localhost/api/groq/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "", userId: "invalid" }),
  }));

  assert.equal(response.status, 200);
  assert.match(await response.text(), /\[ERROR\]Message is required/);
});
