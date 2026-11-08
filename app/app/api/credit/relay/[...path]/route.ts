import { timingSafeEqual } from "node:crypto";
import { CREDIT_URL, deviceToken, relaySecret } from "@/lib/server/credit";

/**
 * A Claude tab's calls on Bluprint credit (Claude Code in Bedrock mode, src-tauri/src/claude.rs),
 * passed to the proxy's capped lane under this machine's token, which the tab never sees. They
 * answer only to the secret this server made when it started, so the credit works through Bluprint
 * while it runs and nowhere else.
 */
export async function POST(request: Request) {
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(relaySecret());
  if (given.length !== want.length || !timingSafeEqual(given, want))
    return Response.json({ message: "Not a Blueprint credit tab." }, { status: 401 });
  const t = await deviceToken();
  if (!("token" in t)) return Response.json({ message: t.reason }, { status: 503 });

  // The path as sent: the model id in it is percent-encoded, and the proxy reads it that way.
  const rest = new URL(request.url).pathname.replace(/^\/api\/credit\/relay/, "");
  const headers = new Headers({ authorization: `Bearer ${t.token}` });
  for (const [k, v] of request.headers) if (k === "content-type" || k === "accept" || k.startsWith("x-amzn-bedrock-")) headers.set(k, v);
  const res = await fetch(`${CREDIT_URL}/tab${rest}`, { method: "POST", headers, body: await request.arrayBuffer() }).catch(() => null);
  if (!res) return Response.json({ message: "Blueprint credit could not be reached." }, { status: 502 });
  const out = new Headers();
  for (const [k, v] of res.headers) if (k === "content-type" || k === "retry-after" || k === "x-should-retry" || k.startsWith("x-amzn-")) out.set(k, v);
  return new Response(res.body, { status: res.status, headers: out });
}
