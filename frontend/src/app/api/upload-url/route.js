import { getRagService } from "../../../lib/server/runtime.js";

export const runtime = "nodejs";

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  try {
    const { url, userId } = payload;
    const { uploadWebsite } = await getRagService();
    return Response.json(await uploadWebsite(url, userId));
  } catch (error) {
    const { getUploadError } = await getRagService();
    const result = getUploadError(error);
    return Response.json({ error: result.error }, { status: result.status });
  }
}
