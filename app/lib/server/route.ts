/** What every API route answers with when a request is refused. */
export const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

/**
 * Refuses any POST that is not JSON. Another site's page can send this local
 * server a plain-text POST without asking, but a JSON one needs a CORS
 * preflight no route grants, so a JSON-only route is out of its reach.
 */
export const notJson = (request: Request) =>
  request.headers.get("content-type")?.startsWith("application/json") ? null : bad("bad request", 415);
