// Blueprint's one backend: a Lambda behind a streaming function URL, keeping its state in DynamoDB
// (db.mjs). Packed as this folder's .mjs files (scripts/api/pack.sh).
//
//   POST /rpc/<name>                    the dashboard and its writers (admin.mjs), JSON in and out
//   POST /register                      {device}            → {token}, or why not   (credit.mjs)
//   GET  /status                        Bearer <token>      → the machine's tab window
//   POST /{tab|gen}/model/{id}/{op}     Bearer <token>      → Bedrock's own reply
//
// Env: TABLE, TOKEN_SECRET, PROFILES ({"haiku": arn, "sonnet": arn, "opus": arn}).
import * as admin from "./admin.mjs";
import { deviceOf, register, relay, status, tokenFor } from "./credit.mjs";

const RPC = {
  bp_track_install: admin.trackInstall,
  bp_track_visit: admin.trackVisit,
  bp_record_run: admin.recordRun,
  bp_admin_overview: admin.overview,
  bp_admin_run: admin.run,
  bp_admin_repo: admin.repo,
  bp_admin_credit: admin.credit,
};

export const handler = awslambda.streamifyResponse(async (event, stream) => {
  const reply = (status, body, headers = {}) => {
    const out = awslambda.HttpResponseStream.from(stream, { statusCode: status, headers: { "content-type": "application/json", ...headers } });
    out.write(JSON.stringify(body ?? null));
    out.end();
  };
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const ip = event.requestContext.http.sourceIp;
  const headers = event.headers ?? {};
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body)) : Buffer.alloc(0);
  const json = () => {
    try {
      return JSON.parse(body.toString("utf8") || "{}");
    } catch {
      return {};
    }
  };

  try {
    const rpc = method === "POST" && path.match(/^\/rpc\/(\w+)$/);
    if (rpc) {
      const fn = Object.hasOwn(RPC, rpc[1]) ? RPC[rpc[1]] : null;
      return fn ? reply(200, await fn(json())) : reply(404, { message: "Not found." });
    }

    if (method === "POST" && path === "/register") {
      const { device } = json();
      const r = await register(device, ip);
      return r.ok ? reply(200, { token: tokenFor(device) }) : reply(403, { message: r.reason });
    }

    const device = deviceOf(headers);
    if (!device) return reply(401, { message: "Not a Blueprint credit token." }, { "x-amzn-errortype": "AccessDeniedException" });
    if (method === "GET" && path === "/status") return reply(200, await status(device));

    const m = method === "POST" && path.match(/^\/(tab|gen)\/model\/([^/]+)\/([a-z-]+)$/);
    if (!m) return reply(404, { message: "Not found." });
    await relay({ stream, reply, device, ip, lane: m[1], model: m[2], op: m[3], headers, body });
  } catch (e) {
    if (e instanceof admin.NotAllowed) return reply(401, { message: e.message });
    console.error(e);
    try {
      reply(500, { message: "Blueprint's server could not answer just now." });
    } catch {
      // The reply had already begun.
    }
  }
});
