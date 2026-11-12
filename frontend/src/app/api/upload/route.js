import { getRagService } from "../../../lib/server/runtime.js";
import { readUploadFormData } from "../../../lib/server/requestBody.js";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const formData = await readUploadFormData(request);
    const file = formData.get("file");
    const userId = formData.get("userId");
    if (!file || typeof file.arrayBuffer !== "function") {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    const { uploadDocument } = await getRagService();
    const result = await uploadDocument(file, userId);
    return Response.json(result);
  } catch (error) {
    if (error?.status === 400 || error?.status === 413) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const { getUploadError } = await getRagService();
    const result = getUploadError(error);
    return Response.json({ error: result.error }, { status: result.status });
  }
}
