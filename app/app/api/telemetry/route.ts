import { readTelemetry, setTelemetry } from "@/lib/server/telemetry";
import { notJson } from "@/lib/server/route";

/** Whether finished runs are reported to the admin dashboard: `GET` → `{on}`, `POST {on}` sets it. */
export async function GET() {
  return Response.json({ on: !(await readTelemetry()).off });
}

export async function POST(request: Request) {
  const refused = notJson(request);
  if (refused) return refused;
  const body = (await request.json().catch(() => null)) as { on?: unknown } | null;
  if (typeof body?.on !== "boolean") return Response.json({ error: "bad request" }, { status: 400 });
  await setTelemetry(body.on);
  return Response.json({ on: body.on });
}
