import assert from "node:assert/strict";
import test from "node:test";
import { readUploadFormData } from "./requestBody.js";

test("parses a bounded multipart upload body", async () => {
  const formData = new FormData();
  formData.append("userId", "browser-id");
  const request = new Request("http://localhost/api/upload", {
    method: "POST",
    body: formData,
  });

  const parsed = await readUploadFormData(request);
  assert.equal(parsed.get("userId"), "browser-id");
});

test("rejects declared oversized upload bodies before parsing", async () => {
  const response = new Request("http://localhost/api/upload", {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=example",
      "content-length": String(11 * 1024 * 1024),
    },
    body: "",
  });

  await assert.rejects(readUploadFormData(response), {
    status: 413,
    message: "File too large. Maximum size is 10MB.",
  });
});
