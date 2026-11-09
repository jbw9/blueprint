import { listFeedback, sendFeedback } from "@/lib/server/feedback";
import { bad, notJson } from "@/lib/server/route";

/** Bug reports and feedback (lib/server/feedback.ts): `GET` → what this machine sent, with each one's status; `POST {kind, message, email?, images}` sends one. */
export async function GET() {
  return Response.json({ reports: await listFeedback() });
}

export async function POST(request: Request) {
  const refused = notJson(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => null)) as { kind?: unknown; message?: unknown; email?: unknown; images?: unknown } | null;
  if (typeof body?.message !== "string" || !body.message.trim()) return bad("Say what happened.");
  const images = Array.isArray(body.images) ? body.images.filter((i): i is string => typeof i === "string").slice(0, 3) : [];
  try {
    const sent = await sendFeedback({
      kind: body.kind === "bug" ? "bug" : "feedback",
      message: body.message,
      email: typeof body.email === "string" && body.email.trim() ? body.email.trim() : undefined,
      images,
    });
    return Response.json({ id: sent.id });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Couldn't send it just now.", 502);
  }
}
