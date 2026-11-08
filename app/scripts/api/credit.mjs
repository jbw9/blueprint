// Bluprint credit: Claude on Bluprint's own Bedrock, for machines running Bluprint. Answers as Bedrock
// does, so Claude Code (in Bedrock mode) and the generator (scripts/generate/bedrock.ts) talk to it
// unchanged. Each call is checked against the machine's allowance (db.mjs), forwarded byte for byte
// to one of the project's tagged inference profiles, and its tokens are written back.
//
// `tab` is Claude Code in a Bluprint tab and is capped per window; `gen` is bluprint generation.
// The settings are the `credit / config` item, changed in the DynamoDB console, never in the app:
// enabled (false: only machines marked `allowed`), window_hours, tab_tokens, gen_tokens (absent: no
// cap), ip_factor, new_devices_per_ip_day, daily_usd_ceiling. A machine's own `tab_tokens` or
// `gen_tokens`, `allowed` and `blocked` go on its `device / <id>` item. A token here is input + cache
// writes + output + a tenth of cache reads, which cost a tenth.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { get, put, refused, today, update, without } from "./db.mjs";

const REGION = process.env.AWS_REGION || "us-east-1";
const HOST = `bedrock-runtime.${REGION}.amazonaws.com`;
const PROFILES = JSON.parse(process.env.PROFILES ?? "{}");
const OPS = new Set(["invoke-with-response-stream", "invoke", "count-tokens"]);

/** $ per million tokens through a global profile; a cache write costs 1.25× input. */
const PRICE = { haiku: { in: 1, out: 5 }, sonnet: { in: 3, out: 15 }, opus: { in: 5, out: 25 } };

const familyOf = (model) => (/haiku/i.test(model) ? "haiku" : /opus/i.test(model) ? "opus" : "sonnet");
/** A tab gets Sonnet or Haiku whatever it asks for; generation gets the family it asks for. */
const familyFor = (lane, model) => (lane === "tab" && familyOf(model) === "opus" ? "sonnet" : familyOf(model));

const sign = (device) => createHmac("sha256", process.env.TOKEN_SECRET).update(device).digest("base64url");
export const tokenFor = (device) => `${device}.${sign(device)}`;
export function deviceOf(headers) {
  const [device, mac] = (headers.authorization ?? "").replace(/^Bearer\s+/i, "").split(".");
  if (!device || !mac || !/^[0-9a-f]{64}$/.test(device)) return null;
  const want = Buffer.from(sign(device));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got) ? device : null;
}

/* ── allowances ── */

const DEFAULTS = { enabled: false, window_hours: 5, tab_tokens: 500000, gen_tokens: null, ip_factor: 3, new_devices_per_ip_day: 3, daily_usd_ceiling: 25 };
let cached = null;
/** The settings, read at most every 30 seconds per running copy of this function. */
async function config() {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const value = { ...DEFAULTS, ...without(await get("credit", "config"), "pk", "sk") };
  cached = { at: Date.now(), value };
  return value;
}

/** Tokens used in the window still open, and when it closes; 0 and null once it has. */
async function windowOf(who, lane, hours) {
  const w = await get(`win#${who}`, lane);
  const ends = w ? Date.parse(w.started) + hours * 3600_000 : 0;
  return ends > Date.now() ? { used: Number(w.tokens) || 0, resets: new Date(ends).toISOString() } : { used: 0, resets: null };
}

/** A machine seen before always gets back in; a new one only while its address has made few today. */
export async function register(device, ip) {
  if (typeof device !== "string" || !/^[0-9a-f]{64}$/.test(device)) return { ok: false, reason: "Not a device id." };
  if (await get("device", device)) return { ok: true };
  const c = await config();
  try {
    await update(`ipreg#${ip}`, today(), "SET n = if_not_exists(n, :zero) + :one, #ttl = :ttl",
      { ":zero": 0, ":one": 1, ":max": c.new_devices_per_ip_day, ":ttl": Math.floor(Date.now() / 1000) + 2 * 86400 },
      "attribute_not_exists(n) OR n < :max", { "#ttl": "ttl" });
  } catch (e) {
    if (refused(e)) return { ok: false, reason: "Too many new machines from this network today." };
    throw e;
  }
  try {
    await put({ pk: "device", sk: device, at: new Date().toISOString(), ip: String(ip).slice(0, 64), allowed: false, blocked: false }, "attribute_not_exists(pk)");
  } catch (e) {
    if (!refused(e)) throw e;
  }
  return { ok: true };
}

/** Whether this machine may make a call now, and if not, why and until when. */
async function admit(device, ip, lane) {
  const c = await config();
  const d = await get("device", device);
  if (!d || d.blocked || !(c.enabled || d.allowed)) return { ok: false, reason: "Bluprint credit is not available on this machine." };
  const spent = Number((await get("creditday", today()))?.usd) || 0;
  if (spent >= c.daily_usd_ceiling)
    return { ok: false, reason: "Bluprint credit has reached its per day limit for everyone. It opens again at midnight UTC.", resets: `${new Date(Date.now() + 86400_000).toISOString().slice(0, 10)}T00:00:00.000Z` };
  const cap = lane === "tab" ? (d.tab_tokens ?? c.tab_tokens) : (d.gen_tokens ?? c.gen_tokens);
  if (cap == null) return { ok: true };
  const [mine, theirs] = await Promise.all([windowOf(`device:${device}`, lane, c.window_hours), windowOf(`ip:${ip}`, lane, c.window_hours)]);
  if (mine.used >= cap) return { ok: false, reason: "Bluprint credit is used up for now.", resets: mine.resets };
  if (theirs.used >= cap * c.ip_factor) return { ok: false, reason: "Bluprint credit is used up on this network for now.", resets: theirs.resets };
  return { ok: true };
}

/** One call's use, added to its machine's and address's windows; a window that has closed starts again here. */
async function spend(device, ip, lane, family, u) {
  const c = await config();
  const n = u.input + u.output + u.cache_write + Math.floor(u.cache_read / 10);
  const usd = usdOf(family, u);
  const now = new Date();
  const cut = new Date(now - c.window_hours * 3600_000).toISOString();
  await Promise.all([
    ...[`device:${device}`, `ip:${ip}`].map((who) =>
      update(`win#${who}`, lane, "SET tokens = tokens + :n", { ":n": n, ":cut": cut }, "started > :cut").catch((e) => {
        if (!refused(e)) throw e;
        return put({ pk: `win#${who}`, sk: lane, started: now.toISOString(), tokens: n, ttl: Math.floor(now / 1000) + c.window_hours * 3600 + 86400 });
      }),
    ),
    update("creditday", today(), "ADD usd :u, #lane :u", { ":u": usd }, undefined, { "#lane": `${lane}_usd` }),
    update(`devuse#${today()}`, device, "ADD #lane :n, usd :u SET last_at = :now", { ":n": n, ":u": usd, ":now": now.toISOString() }, undefined, { "#lane": `${lane}_tokens` }),
  ]);
}

/** What the app shows: whether the credit is there for this machine, and its tab window. */
export async function status(device) {
  const c = await config();
  const d = await get("device", device);
  const w = await windowOf(`device:${device}`, "tab", c.window_hours);
  return { available: !!d && !d.blocked && (c.enabled || !!d.allowed), used: w.used, limit: d?.tab_tokens ?? c.tab_tokens, resets: w.resets, window_hours: c.window_hours };
}

/* ── SigV4, for the one host and two headers this needs ── */
const sha = (s) => createHash("sha256").update(s).digest("hex");
const hmac = (k, s) => createHmac("sha256", k).update(s).digest();
function signed(path, body, extra) {
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = now.slice(0, 8);
  const headers = { host: HOST, "x-amz-date": now, ...(process.env.AWS_SESSION_TOKEN ? { "x-amz-security-token": process.env.AWS_SESSION_TOKEN } : {}) };
  const names = Object.keys(headers).sort();
  // Bedrock, like every service but S3, signs each path segment encoded a second time.
  const uri = path.split("/").map((s) => encodeURIComponent(s)).join("/");
  const canonical = ["POST", uri, "", ...names.map((n) => `${n}:${headers[n]}`), "", names.join(";"), sha(body)].join("\n");
  const scope = `${day}/${REGION}/bedrock/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha(canonical)].join("\n");
  let k = hmac(`AWS4${process.env.AWS_SECRET_ACCESS_KEY}`, day);
  for (const part of [REGION, "bedrock", "aws4_request"]) k = hmac(k, part);
  const signature = createHmac("sha256", k).update(toSign).digest("hex");
  return {
    ...extra,
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${process.env.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

/**
 * Reads the usage out of Bedrock's event stream as it passes, without holding it up: each message is
 * a length-prefixed frame whose payload is {"bytes": base64 of one Anthropic stream event}.
 */
function meter() {
  const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let buf = Buffer.alloc(0);
  const take = (ev) => {
    const u = ev.type === "message_start" ? ev.message?.usage : ev.type === "message_delta" ? ev.usage : null;
    if (!u) return;
    if (u.input_tokens != null) usage.input = u.input_tokens;
    if (u.cache_read_input_tokens != null) usage.cache_read = u.cache_read_input_tokens;
    if (u.cache_creation_input_tokens != null) usage.cache_write = u.cache_creation_input_tokens;
    if (u.output_tokens != null) usage.output = u.output_tokens;
  };
  return {
    usage,
    push(chunk) {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 12) {
        const total = buf.readUInt32BE(0);
        if (buf.length < total) break;
        const headers = buf.readUInt32BE(4);
        const payload = buf.subarray(12 + headers, total - 4);
        buf = buf.subarray(total);
        try {
          const b = JSON.parse(payload.toString("utf8")).bytes;
          if (b) take(JSON.parse(Buffer.from(b, "base64").toString("utf8")));
        } catch {
          // An exception frame, or one this does not read: it still reached the caller.
        }
      }
    },
    json(text) {
      try {
        const u = JSON.parse(text).usage ?? {};
        take({ type: "message_start", message: { usage: u } });
        take({ type: "message_delta", usage: u });
      } catch {
        // Not a reply with usage.
      }
    },
  };
}

const usdOf = (family, u) => {
  const p = PRICE[family];
  return (u.input * p.in + u.cache_write * p.in * 1.25 + u.cache_read * p.in * 0.1 + u.output * p.out) / 1e6;
};

/** Answers one Bedrock call on a lane, as Bedrock would, writing to `stream`. */
export async function relay({ stream, reply, device, ip, lane, model, op, headers, body }) {
  const family = familyFor(lane, decodeURIComponent(model));
  const target = op === "count-tokens" ? decodeURIComponent(model) : PROFILES[family];
  if (!OPS.has(op)) return reply(404, { message: "Not found." });

  // Counting tokens costs nothing, so it is not metered.
  if (op !== "count-tokens") {
    const ok = await admit(device, ip, lane);
    if (!ok.ok) {
      const until = ok.resets && !ok.reason.includes("midnight") ? ` It opens again at ${new Date(ok.resets).toUTCString()}.` : "";
      // Not a throttle, which Claude Code and the generator would retry for minutes.
      return reply(429, { message: `${ok.reason}${until} Turn off Bluprint credit in Settings to use your own Claude.` }, {
        "x-should-retry": "false",
        "x-amzn-errortype": "ServiceQuotaExceededException",
        ...(ok.resets ? { "retry-after": String(Math.max(1, Math.round((Date.parse(ok.resets) - Date.now()) / 1000))) } : {}),
      });
    }
  }

  const upstream = `/model/${encodeURIComponent(target)}/${op}`;
  const pass = Object.fromEntries(Object.entries(headers).filter(([k]) => k === "content-type" || k === "accept" || k.startsWith("x-amzn-bedrock-")));
  const res = await fetch(`https://${HOST}${upstream}`, { method: "POST", headers: signed(upstream, body, pass), body });
  const out = awslambda.HttpResponseStream.from(stream, {
    statusCode: res.status,
    headers: Object.fromEntries([...res.headers].filter(([k]) => k === "content-type" || k.startsWith("x-amzn-"))),
  });
  const meters = meter();
  if (op === "invoke-with-response-stream" && res.ok) {
    for await (const chunk of res.body) {
      const b = Buffer.from(chunk);
      meters.push(b);
      out.write(b);
    }
  } else {
    const text = await res.text();
    if (op === "invoke" && res.ok) meters.json(text);
    out.write(text);
  }
  out.end();
  if (op !== "count-tokens" && res.ok) await spend(device, ip, lane, family, meters.usage);
}
