import { getRagService } from "../../../../lib/server/runtime.js";

export const runtime = "nodejs";

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const { streamChat } = await getRagService();
  const iterator = streamChat(payload.message, payload.userId, request.signal);
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
