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
    const { message, userId } = payload;
    const { chat } = await getRagService();
    return Response.json(await chat(message, userId));
  } catch (error) {
    const { getChatError } = await getRagService();
    const result = getChatError(error);
    return Response.json({ error: result.error }, { status: result.status });
  }
}
