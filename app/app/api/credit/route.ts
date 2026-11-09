import { creditStatus, pollSignIn, relayAt, relaySecret, setCreditOn, setFallback, signOut, startSignIn, usedUp } from "@/lib/server/credit";
import { notJson } from "@/lib/server/route";

/**
 * Blueprint credit on this machine: `GET` → its status, and with the credit on, where a Claude tab
 * sends its calls (`relay`): with `fallback`, none once its session or week is used up, so a new tab
 * opens on the reader's own Claude Code until the credit resets. `POST {on}` turns it on or off,
 * `{fallback}` whether it moves to the reader's own Claude Code; `{signin: "start"}` asks GitHub for a
 * code to enter, `{signin: "poll"}` asks whether it has been entered, and `{signout: true}` ends
 * the session.
 */
export async function GET(request: Request) {
  const url = relayAt(request);
  const s = await creditStatus();
  const relay = s.available && s.on && !(s.fallback && (usedUp(s.meters?.session) || usedUp(s.meters?.week))) ? { url, token: await relaySecret() } : null;
  return Response.json({ ...s, relay });
}

export async function POST(request: Request) {
  const refused = notJson(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => null)) as { on?: unknown; fallback?: unknown; signin?: unknown; signout?: unknown } | null;
  if (body?.signin === "start") return Response.json(await startSignIn());
  if (body?.signin === "poll") return Response.json(await pollSignIn());
  if (body?.signout === true) return (await signOut(), Response.json({}));
  if (typeof body?.fallback === "boolean") return (await setFallback(body.fallback), Response.json({ fallback: body.fallback }));
  if (typeof body?.on !== "boolean") return Response.json({ error: "bad request" }, { status: 400 });
  await setCreditOn(body.on);
  return Response.json({ on: body.on });
}
