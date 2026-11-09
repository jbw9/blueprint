import { checkUpdate, updateStatus } from "@/lib/server/update";

/** `GET` → `{version, ready}`: the release running, and the one staged for the next restart (null for none). Asking looks for a newer one, at most every 6 hours. */
export function GET() {
  checkUpdate();
  return Response.json(updateStatus());
}
