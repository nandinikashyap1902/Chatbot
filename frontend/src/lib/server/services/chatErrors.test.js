import assert from "node:assert/strict";
import test from "node:test";
import { getPublicVisionError } from "./chatErrors.js";

test("explains when the configured Groq vision model is unavailable", () => {
  const message = getPublicVisionError({
    status: 404,
    error: { error: { code: "model_not_found" } },
  });

  assert.match(message, /qwen\/qwen3\.8-27b/);
  assert.match(message, /GROQ_VISION_MODEL/);
});

test("returns an actionable authentication error for image analysis", () => {
  assert.match(
    getPublicVisionError({ status: 401 }),
    /GROQ_API_KEY/,
  );
});
