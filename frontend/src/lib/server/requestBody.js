const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 64 * 1024;

export class RequestBodyError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}

export async function readUploadFormData(request) {
  const contentLength = Number(request.headers.get("content-length"));
  const maxBytes = MAX_FILE_SIZE + MAX_MULTIPART_OVERHEAD;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyError("File too large. Maximum size is 10MB.", 413);
  }

  if (!request.body) throw new RequestBodyError("No file uploaded", 400);

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new RequestBodyError("File too large. Maximum size is 10MB.", 413);
    }
    chunks.push(value);
  }

  try {
    const body = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
    return await new Response(body, {
      headers: { "content-type": request.headers.get("content-type") || "" },
    }).formData();
  } catch {
    throw new RequestBodyError("Invalid multipart form data", 400);
  }
}
