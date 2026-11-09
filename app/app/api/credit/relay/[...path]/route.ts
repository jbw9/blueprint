import { timingSafeEqual } from "node:crypto";
import { api } from "@/lib/server/api";
import { accessToken, dropAccess, relaySecret } from "@/lib/server/credit";

/**
 * Calls on Blueprint credit, passed to the proxy under the signed-in account's access token, which
 * the caller never sees: a Claude tab's (Claude Code in Bedrock mode, src-tauri/src/claude.rs) to
 * its `tab` lane, and the generator's (scripts/generate/bedrock.ts), sent under `/gen`, to its
 * `gen` lane. They answer only to the secret this machine's Blueprint keeps (lib/server/credit.ts,
 * relaySecret), so the credit works through Blueprint and nowhere else.
 */
export async function POST(request: Request) {
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(await relaySecret());
  if (given.length !== want.length || !timingSafeEqual(given, want))
    return Response.json({ message: "Not a Blueprint credit tab." }, { status: 401 });

  // The path as sent: the model id in it is percent-encoded, and the proxy reads it that way.
  const path = new URL(request.url).pathname.replace(/^\/api\/credit\/relay/, "");
  const lane = path.startsWith("/gen/") ? "gen" : "tab";
  const rest = lane === "gen" ? path.slice(4) : path;
  if (!/^\/model\/[^/]+\/[a-z-]+$/.test(rest)) return Response.json({ message: "Not found." }, { status: 404 });
  const token = await accessToken();
  if (!token)
    return Response.json({ message: "Blueprint credit is signed out. Sign in again in Settings." }, { status: 401, headers: { "x-amzn-errortype": "AccessDeniedException" } });

  const headers = new Headers({ authorization: `Bearer ${token}` });
  // Claude Code's hints say which of its calls this is (main, subagent, compaction), which the proxy logs.
  for (const [k, v] of request.headers)
    if (k === "content-type" || k === "accept" || k.startsWith("x-amzn-bedrock-") || k.startsWith("x-claude-code-")) headers.set(k, v);
  // A caller that stops (Esc in a tab) stops the call upstream too, and is charged for what came.
  const res = await api(`/${lane}${rest}`, { method: "POST", headers, body: await request.arrayBuffer(), signal: request.signal }).catch(() => null);
  if (!res) return Response.json({ message: "Blueprint credit could not be reached." }, { status: 502 });
  if (res.status === 401) dropAccess();
  const out = new Headers();
  for (const [k, v] of res.headers) if (k === "content-type" || k === "retry-after" || k === "x-should-retry" || k.startsWith("x-amzn-")) out.set(k, v);
  return new Response(res.body, { status: res.status, headers: out });
}
