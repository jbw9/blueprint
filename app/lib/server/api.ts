import { VERSION, checkUpdate } from "@/lib/server/update";

/** Blueprint's own backend (scripts/api): run reports and Blueprint credit. A Lambda on the project's AWS account. */
export const API_URL = "https://rn24aj5jclm6ioyeqrlsxbztky0bfwgc.lambda-url.us-east-1.on.aws";

/**
 * A call to the backend, saying which Blueprint makes it. A 426 is the backend refusing a version
 * too old for it (MIN_CLIENT in scripts/api/index.mjs), and the app goes to get the new one.
 */
export async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-blueprint-version", VERSION ?? "source");
  const r = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (r.status === 426) checkUpdate(true);
  return r;
}
