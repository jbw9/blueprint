// Blueprint's one backend: a Lambda behind a streaming function URL, keeping its state in DynamoDB
// (db.mjs). Packed as this folder's .mjs files (scripts/api/pack.sh).
//
//   POST /rpc/<name>                    the dashboard and its writers (admin.mjs), JSON in and out
//   POST /signin                        {github_token, device} → {session, login}, or why not   (auth.mjs)
//   POST /token                         Bearer <session>    → {token, exp}, an access token for 30 minutes
//   POST /signout                       Bearer <session>
//   GET  /promo                         whether the free Claude Code promotion is on        (credit.mjs)
//   GET  /status                        Bearer <token>      → the account's windows
//   POST /{tab|gen}/model/{id}/{op}     Bearer <token>      → Bedrock's own reply
//
// Env: TABLE, TOKEN_SECRET, PROFILES ({"haiku": arn, "sonnet": arn, "opus": arn}).
import * as admin from "./admin.mjs";
import { accessOf, network, refresh, signIn, signOut } from "./auth.mjs";
import { promo, relay, status } from "./credit.mjs";
import { under } from "./db.mjs";

/** Asks per minute from one network: generous for a person, small for a script. The dashboard's ask a password. */
const PER_MINUTE = { bp_track_install: 30, bp_track_visit: 120, bp_record_run: 30, admin: 30, signin: 10 };

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
      if (!fn) return reply(404, { message: "Not found." });
      const route = rpc[1].startsWith("bp_admin_") ? "admin" : rpc[1];
      if (!(await under(`${route}#${network(ip)}`, PER_MINUTE[route]))) return reply(429, { message: "Too many requests. Try again in a minute." });
      return reply(200, await fn(json()));
    }

    if (method === "GET" && path === "/promo") return reply(200, await promo(), { "cache-control": "public, max-age=300" });
    if (method === "POST" && path === "/signin") {
      if (!(await under(`signin#${network(ip)}`, PER_MINUTE.signin))) return reply(429, { message: "Too many sign-ins from this network. Try again in a minute." });
      const r = await signIn(json(), ip);
      return r.session ? reply(200, r) : reply(403, { message: r.reason });
    }
    if (method === "POST" && path === "/token") {
      const t = await refresh(headers);
      return t ? reply(200, t) : reply(401, { message: "Sign in to Blueprint credit again." });
    }
    if (method === "POST" && path === "/signout") return (await signOut(headers), reply(200, {}));
    // Machines once registered themselves; a machine id is not proof of anything, so that is gone.
    if (method === "POST" && path === "/register") return reply(410, { message: "Update Blueprint: its credit now signs in with GitHub." });

    const who = accessOf(headers);
    if (!who) return reply(401, { message: "Not a Blueprint credit token." }, { "x-amzn-errortype": "AccessDeniedException" });
    if (method === "GET" && path === "/status") return reply(200, await status(who.account));

    const m = method === "POST" && path.match(/^\/(tab|gen)\/model\/([^/]+)\/([a-z-]+)$/);
    if (!m) return reply(404, { message: "Not found." });
    await relay({ stream, reply, account: who.account, ip, lane: m[1], model: m[2], op: m[3], headers, body });
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
