import { creditStatus, relaySecret, setCreditOn } from "@/lib/server/credit";
import { notJson } from "@/lib/server/route";

/**
 * Blueprint credit on this machine: `GET` → its status, and with the credit on, where a Claude tab
 * sends its calls (`relay`); `POST {on}` turns it on or off.
 */
export async function GET(request: Request) {
  const s = await creditStatus();
  const relay = s.available && s.on ? { url: `${new URL(request.url).origin}/api/credit/relay`, token: relaySecret() } : null;
  return Response.json({ ...s, relay });
}

export async function POST(request: Request) {
  const refused = notJson(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => null)) as { on?: unknown } | null;
  if (typeof body?.on !== "boolean") return Response.json({ error: "bad request" }, { status: 400 });
  await setCreditOn(body.on);
  return Response.json({ on: body.on });
}
