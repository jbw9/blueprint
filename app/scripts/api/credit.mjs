// Blueprint credit: Claude on Blueprint's own Bedrock, for people signed in to Blueprint with GitHub
// (auth.mjs). Answers as Bedrock does, so Claude Code (in Bedrock mode) and the generator
// (scripts/generate/bedrock.ts) talk to it unchanged, both through the app's local relay. Each call is
// shaped (policy.mjs), admitted against its account's allowance, forwarded byte for byte to one of
// the project's tagged inference profiles, and settled at what Bedrock says it used.
//
// `tab` is Claude Code in a Blueprint tab and has a 5-hour window and a weekly one, as Claude Code's
// own plans do; `gen` is blueprint generation and has a weekly window. Spend is in millionths of a
// dollar at list price (a price in $ per million tokens is micro-dollars per token). The settings
// are the `credit / config` item (DEFAULTS), changed in the DynamoDB console, never in the app. An
// account's own item can carry any of the limits, or `uncapped`, `allowed` (let in while the credit
// is off for everyone) or `blocked`.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { network } from "./auth.mjs";
import { del, get, put, refused, today, update, without } from "./db.mjs";
import { shape } from "./policy.mjs";

const REGION = process.env.AWS_REGION || "us-east-1";
const HOST = `bedrock-runtime.${REGION}.amazonaws.com`;
const PROFILES = JSON.parse(process.env.PROFILES ?? "{}");
const OPS = new Set(["invoke-with-response-stream", "invoke", "count-tokens"]);

/** $ per million tokens through a global profile (the 5.5 models); a cache write costs 1.25× input. Haiku's is for prompts up to 100K tokens. */
const PRICE = { haiku: { in: 0.1, out: 0.5, cr: 0.01 }, sonnet: { in: 2, out: 10, cr: 0.2 }, opus: { in: 4, out: 20, cr: 0.2 } };

const familyOf = (model) => (/haiku/i.test(model) ? "haiku" : /opus/i.test(model) ? "opus" : "sonnet");

/* ── settings ── */

export const DEFAULTS = {
  enabled: false,
  ends_at: null,
  policy: "log",
  gh_min_age_days: 30,
  devices_per_account: 2,
  new_accounts_per_ip_day: 5,
  window_hours: 5,
  week_hours: 168,
  // About half of Claude Pro: its 5-hour session runs to roughly $6–8 of Claude Code at list price.
  tab_usd_5h: 4,
  tab_usd_week: 40,
  // Maps are offered as unlimited: this is fair use, about sixteen mid-size maps a week, which nobody making maps
  // reaches. It is what holds the lane to its price, since anyone signed in can call it without the generator.
  gen_usd_week: 200,
  // A tab's own throttles; map generation has none, so it runs as fast as Bedrock takes it.
  tab_inflight: 3,
  usd_per_minute: 1,
  max_tokens: 32000,
  // The generator's authors ask for 64,000 (scripts/generate/author.ts); cut at 32,000 they stop mid-answer.
  gen_max_tokens: 64000,
  // What `gen` calls are held to when it differs from `policy`: the generator is Blueprint's own, so its shape is known.
  gen_policy: null,
  // Everyone's spend this calendar month, kept under the AWS Budget's own cut-off (80% of $6,000), so
  // the credit stops with a clear message before Bedrock is taken away from this function.
  monthly_usd_ceiling: 4500,
};
let cached = null;
/** The settings, read at most every 30 seconds per running copy of this function. */
export async function config() {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const value = { ...DEFAULTS, ...without(await get("credit", "config"), "pk", "sk") };
  cached = { at: Date.now(), value };
  return value;
}

const MICRO = 1e6;
const epoch = () => Math.floor(Date.now() / 1000);
const ended = (c) => !!c.ends_at && Date.now() >= Date.parse(c.ends_at);
const open = (c, a) => !!a && !a.blocked && (!!a.allowed || (!!c.enabled && !ended(c)));

/** What the landing page asks: whether the promotion is on for everyone right now, and when it ends. */
export async function promo() {
  const c = await config();
  return { on: !!c.enabled && !ended(c), ends_at: c.ends_at ?? null };
}

/** The windows a lane spends from, and how long each stays open. */
const WINDOWS = { tab: ["tab5h", "tabweek"], gen: ["genweek"] };
const hoursOf = (c, w) => (w === "tab5h" ? c.window_hours : c.week_hours);
const LIMIT_OF = { tab5h: "tab_usd_5h", tabweek: "tab_usd_week", genweek: "gen_usd_week" };
const pick = (c, a, k) => a?.[k] ?? c[k];
/** A window's cap in µ$, or null for none: an uncapped account, or a limit set to null. */
const limitOf = (c, a, w) => (a?.uncapped || pick(c, a, LIMIT_OF[w]) == null ? null : pick(c, a, LIMIT_OF[w]) * MICRO);
const capOf = (c, a, w) => limitOf(c, a, w) ?? Number.MAX_SAFE_INTEGER;

/** Spend in a window while it is open, and when it closes; nothing once it has. */
async function windowOf(account, w, hours) {
  const row = await get(`win#acct:${account}`, w);
  const ends = row?.started ? Date.parse(row.started) + hours * 3600_000 : 0;
  return ends > Date.now() ? { used: Number(row.micro) || 0, resets: new Date(ends).toISOString() } : { used: 0, resets: null };
}

/** What the app shows: whether the credit is there for this account, and each of its windows. */
export async function status(account) {
  const c = await config();
  const a = await get("account", account);
  const meters = Object.fromEntries(
    await Promise.all(
      Object.keys(LIMIT_OF).map(async (w) => [w, { ...(await windowOf(account, w, hoursOf(c, w))), limit: limitOf(c, a, w) }]),
    ),
  );
  const reason = !a ? "Sign in again." : a.blocked ? "Blueprint credit isn't available to this account." : ended(c) && !a.allowed ? "Blueprint's free Claude Code promotion has ended." : !open(c, a) ? "Blueprint credit isn't open yet." : undefined;
  return { available: open(c, a), reason, login: a?.login ?? null, ends_at: c.ends_at ?? null, meters };
}

/* ── admitting and settling a call ── */

/**
 * Adds `micro` to an open window while it is under `cap`, or starts the window afresh once the last has
 * closed. The update is conditional, so calls made at once each see the others' share. `started` names
 * the window it was charged to, so settling never lands on the next one; `resets` is when a full window opens again.
 */
async function charge(account, w, hours, cap, micro, again = true) {
  const key = `win#acct:${account}`;
  const cut = new Date(Date.now() - hours * 3600_000).toISOString();
  try {
    const row = await update(key, w, "SET micro = micro + :m", { ":m": micro, ":cut": cut, ":cap": cap }, "started > :cut AND micro < :cap");
    return { started: row.started };
  } catch (e) {
    if (!refused(e)) throw e;
  }
  const row = await get(key, w);
  if (row?.started > cut) {
    // Opened by a call made at the same moment, after this one's update missed it: under the cap, charge it.
    if (again && Number(row.micro) < cap) return charge(account, w, hours, cap, micro, false);
    return { resets: new Date(Date.parse(row.started) + hours * 3600_000).toISOString() };
  }
  const started = new Date().toISOString();
  try {
    await put({ pk: key, sk: w, started, micro, ttl: epoch() + hours * 3600 + 86400 }, "attribute_not_exists(pk) OR attribute_not_exists(started) OR started <= :cut", { ":cut": cut });
    return { started };
  } catch (e) {
    // Another call opened the window first: it is open now.
    if (!refused(e) || !again) throw e;
    return charge(account, w, hours, cap, micro, false);
  }
}

/** One of the account's `n` call slots on a lane, held until released; null when all are taken. A lease ends with the function's 15-minute limit, so a call that dies holding one frees it. */
async function takeSlot(account, lane, n) {
  const lease = randomBytes(8).toString("hex");
  for (let i = 0; i < n; i++) {
    try {
      await put({ pk: `slot#${account}`, sk: `${lane}#${i}`, lease_id: lease, lease_until: Date.now() + 900_000, ttl: epoch() + 1800 }, "attribute_not_exists(pk) OR lease_until < :now", { ":now": Date.now() });
      return { sk: `${lane}#${i}`, lease };
    } catch (e) {
      if (!refused(e)) throw e;
    }
  }
  return null;
}

const quiet = (p) =>
  p.catch((e) => {
    if (!refused(e)) console.error(e);
  });

/** Moves everything a call reserved from its guess to what it cost, and lets its slot go. Settling at 0 undoes a call that never ran. */
async function settle(account, lane, held, micro) {
  const d = micro - held.guess;
  await Promise.all([
    // Only to the window the call was charged to: one that has since closed and reopened is left alone.
    ...held.windows.map(({ w, started }) => quiet(update(`win#acct:${account}`, w, "ADD micro :d", { ":d": d, ":s": started }, "started = :s"))),
    held.minute && quiet(update(`rate#${account}`, held.minute, "ADD micro :d", { ":d": d })),
    held.day && quiet(update("creditday", held.day, "ADD usd :u, #lane :u", { ":u": d / MICRO }, undefined, { "#lane": `${lane}_usd` })),
    held.month && quiet(update("creditmonth", held.month, "ADD usd :u", { ":u": d / MICRO })),
    held.slot && quiet(del(`slot#${account}`, held.slot.sk, "lease_id = :l", { ":l": held.slot.lease })),
  ]);
}

const until = (iso) => Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 1000));

/**
 * Whether this account may make a call now, reserving `guess` against every limit it meets: a call
 * slot, the account's spend this minute, everyone's spend this month, and the lane's windows. A refusal
 * gives back whatever was reserved before it. `wait` refusals are a throttle the caller retries;
 * the others last until `resets`.
 */
async function admit(c, account, a, lane, guess) {
  if (!open(c, a)) return { ok: false, kind: "closed", reason: ended(c) && !a?.allowed ? "Blueprint's free Claude Code promotion has ended." : "Blueprint credit isn't available to this account." };
  const held = { guess, windows: [], minute: null, day: null, month: null, slot: null };
  const no = async (r) => (await settle(account, lane, held, 0), { ok: false, ...r });

  if (lane === "tab") {
    held.slot = await takeSlot(account, lane, pick(c, a, "tab_inflight"));
    if (!held.slot) return no({ kind: "slots", wait: 5, reason: "Too many Claude calls at once on this account; this one waits its turn." });
  }

  if (lane === "tab" && !a.uncapped) {
    const minute = new Date().toISOString().slice(0, 16);
    const cap = pick(c, a, "usd_per_minute") * MICRO;
    try {
      await update(`rate#${account}`, minute, "ADD micro :m SET #ttl = :ttl", { ":m": guess, ":cap": cap, ":ttl": epoch() + 3600 }, "attribute_not_exists(micro) OR micro < :cap", { "#ttl": "ttl" });
      held.minute = minute;
    } catch (e) {
      if (!refused(e)) throw e;
      return no({ kind: "minute", wait: 61 - new Date().getSeconds(), reason: "This account is spending fast; calls slow down for a minute." });
    }
  }

  const day = today();
  const month = day.slice(0, 7);
  try {
    // An uncapped account's spend still counts toward the month, but the month's ceiling doesn't stop it.
    if (a.uncapped) await update("creditmonth", month, "ADD usd :u", { ":u": guess / MICRO });
    else await update("creditmonth", month, "ADD usd :u", { ":u": guess / MICRO, ":cap": c.monthly_usd_ceiling }, "attribute_not_exists(usd) OR usd < :cap");
    held.month = month;
  } catch (e) {
    if (!refused(e)) throw e;
    return no({ kind: "month", reason: "Blueprint credit has run out for this month. Switch to your own Claude Code in Settings.", resets: new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString() });
  }
  // The day's spend, for the admin page.
  await update("creditday", day, "ADD usd :u, #lane :u", { ":u": guess / MICRO }, undefined, { "#lane": `${lane}_usd` });
  held.day = day;

  for (const w of WINDOWS[lane]) {
    const { started, resets } = await charge(account, w, hoursOf(c, w), capOf(c, a, w), guess);
    if (resets) return no({ kind: w, reason: w === "genweek" ? "This week's Blueprint credit for maps is used up." : "Your Blueprint credit for Claude Code is used up for now.", resets });
    held.windows.push({ w, started });
  }
  return { ok: true, held };
}

/** A rough price for a call before Bedrock says what it used: its prompt as if a tenth were new, and up to 4,000 tokens out. */
const guessOf = (family, bytes, maxTokens) => Math.ceil((bytes / 4) * PRICE[family].in * 0.1 + Math.min(maxTokens, 4000) * PRICE[family].out);
/**
 * The most a call can cost: a token per byte of prompt, all of it written to the hour cache, and every token
 * out it may ask for. Maps have no cap on calls at once, so only this keeps a burst within the week's cap:
 * the window stops admitting once it is reached, over it by at most the last call's own.
 */
const worstOf = (family, bytes, maxTokens) => Math.ceil(bytes * PRICE[family].in * 2 + maxTokens * PRICE[family].out);
/** A one-hour cache write costs twice the input price; `cache_write` counts both kinds. */
const microOf = (family, u) => {
  const p = PRICE[family];
  const hour = Math.min(u.cache_write_1h ?? 0, u.cache_write);
  return Math.ceil(u.input * p.in + (u.cache_write - hour) * p.in * 1.25 + hour * p.in * 2 + u.cache_read * p.cr + u.output * p.out);
};

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
 * a length-prefixed frame whose payload is {"bytes": base64 of one Anthropic stream event}. A stream
 * cut off before its final usage is counted by the characters that did come.
 */
function meter() {
  const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, cache_write_1h: 0 };
  let buf = Buffer.alloc(0);
  let chars = 0;
  let final = false;
  const take = (ev) => {
    if (ev.type === "content_block_delta") chars += (ev.delta?.text ?? ev.delta?.thinking ?? ev.delta?.partial_json ?? "").length;
    const u = ev.type === "message_start" ? ev.message?.usage : ev.type === "message_delta" ? ev.usage : null;
    if (!u) return;
    if (ev.type === "message_delta") final = true;
    if (u.input_tokens != null) usage.input = u.input_tokens;
    if (u.cache_read_input_tokens != null) usage.cache_read = u.cache_read_input_tokens;
    if (u.cache_creation_input_tokens != null) usage.cache_write = u.cache_creation_input_tokens;
    if (u.cache_creation?.ephemeral_1h_input_tokens != null) usage.cache_write_1h = u.cache_creation.ephemeral_1h_input_tokens;
    if (u.output_tokens != null) usage.output = u.output_tokens;
  };
  return {
    usage: () => (final ? usage : { ...usage, output: Math.max(usage.output, Math.ceil(chars / 4)) }),
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

/** A refused call, counted by why for the admin page: none of them reached Bedrock. */
const countRefusal = (lane, kind) =>
  quiet(update(`usage#${today()}`, "refused", "ADD #k :one SET #ttl = if_not_exists(#ttl, :ttl)", { ":one": 1, ":ttl": epoch() + 400 * 86400 }, undefined, { "#k": `${lane}_${kind ?? "other"}`, "#ttl": "ttl" }));

/** One call kept 30 days, for review, and its tokens added to the account's day and to its model's. */
async function record(account, lane, family, ip, headers, flags, code, u, micro) {
  const now = new Date();
  await Promise.all([
    quiet(
      update(`usage#${today()}`, `${lane}#${family}`, "ADD calls :one, micro :m, in_tok :i, out_tok :o, cr_tok :r, cw_tok :w, cw1h_tok :h, flagged :f, failed :x, throttled :t SET #ttl = if_not_exists(#ttl, :ttl)",
        { ":one": 1, ":m": micro, ":i": u.input, ":o": u.output, ":r": u.cache_read, ":w": u.cache_write, ":h": u.cache_write_1h ?? 0, ":f": flags.length ? 1 : 0, ":x": code >= 200 && code < 300 ? 0 : 1, ":t": code === 429 ? 1 : 0, ":ttl": epoch() + 400 * 86400 },
        undefined, { "#ttl": "ttl" }),
    ),
    quiet(
      put({
        pk: `req#${account}`,
        sk: `${now.toISOString()}#${randomBytes(3).toString("hex")}`,
        lane,
        family,
        cls: String(headers["x-claude-code-request-class"] ?? "").slice(0, 20) || undefined,
        code,
        in_tok: u.input,
        out_tok: u.output,
        cr_tok: u.cache_read,
        cw_tok: u.cache_write,
        cw1h_tok: u.cache_write_1h || undefined,
        micro,
        net: network(ip),
        flags: flags.length ? flags : undefined,
        ttl: epoch() + 30 * 86400,
      }),
    ),
    quiet(
      update(`use#${today()}`, account, "ADD #calls :one, #micro :m, in_tok :i, out_tok :o, cr_tok :r, cw_tok :w, flagged :f SET last_at = :now, #ttl = :ttl",
        { ":one": 1, ":m": micro, ":i": u.input, ":o": u.output, ":r": u.cache_read, ":w": u.cache_write, ":f": flags.length ? 1 : 0, ":now": now.toISOString(), ":ttl": epoch() + 120 * 86400 },
        undefined, { "#calls": `${lane}_calls`, "#micro": `${lane}_micro`, "#ttl": "ttl" }),
    ),
    // Kept for good, everyone's and each account's: the dashboard's lifetime totals, which the dated rows above expire out of.
    ...["all", account].map((sk) =>
      quiet(
        update("life", sk, "ADD #calls :one, #micro :m, #tok :t, in_tok :i, out_tok :o, cr_tok :r, cw_tok :w, failed :x, flagged :f SET first_at = if_not_exists(first_at, :now), last_at = :now",
          { ":one": 1, ":m": micro, ":t": u.input + u.output + u.cache_read + u.cache_write, ":i": u.input, ":o": u.output, ":r": u.cache_read, ":w": u.cache_write, ":x": code >= 200 && code < 300 ? 0 : 1, ":f": flags.length ? 1 : 0, ":now": now.toISOString() },
          undefined, { "#calls": `${lane}_calls`, "#micro": `${lane}_micro`, "#tok": `${lane}_tok` }),
      ),
    ),
  ]);
}

/** Answers one Bedrock call on a lane, as Bedrock would, writing to `stream`. */
export async function relay({ stream, reply, account, ip, lane, model, op, headers, body }) {
  if (!OPS.has(op)) return reply(404, { message: "Not found." });
  const c = await config();
  const a = await get("account", account);
  const refuse = (r) => {
    const after = r.wait ?? (r.resets ? until(r.resets) : null);
    // A throttle Claude Code and the generator retry; a used-up allowance they show at once, which a retry-after over 60 does.
    return reply(429, { message: r.wait ? r.reason : `${r.reason}${r.resets && !r.reason.includes("midnight") ? ` It opens again at ${new Date(r.resets).toUTCString()}.` : ""} Turn off Blueprint credit in Settings to use your own Claude.` }, {
      "x-should-retry": r.wait ? "true" : "false",
      "x-amzn-errortype": r.wait ? "ThrottlingException" : "ServiceQuotaExceededException",
      ...(after ? { "retry-after": String(after) } : {}),
    });
  };

  // Counting tokens costs nothing, so it is not metered, only kept to Claude models.
  if (op === "count-tokens") {
    const id = decodeURIComponent(model);
    if (!open(c, a)) return refuse({ reason: "Blueprint credit isn't available to this account." });
    if (!/^((global|us|eu|apac)\.)?anthropic\.claude-[\w.:-]+$/.test(id)) return reply(400, { message: "Not a Claude model." });
    return forward({ stream, op, target: id, headers, body });
  }

  const family = familyOf(decodeURIComponent(model));
  const shaped = shape({ lane, body, headers, maxTokens: lane === "gen" ? c.gen_max_tokens : c.max_tokens });
  if (!shaped.body) return reply(400, { message: "Not a model call." }, { "x-amzn-errortype": "ValidationException" });
  if (shaped.flags.length && (lane === "gen" ? (c.gen_policy ?? c.policy) : c.policy) === "enforce") {
    await record(account, lane, family, ip, headers, shaped.flags, 403, { input: 0, output: 0, cache_read: 0, cache_write: 0 }, 0);
    return reply(403, { message: "Blueprint credit only runs Claude Code in Blueprint's tabs and Blueprint's own map generation." }, { "x-amzn-errortype": "AccessDeniedException" });
  }

  const guess = (lane === "gen" ? worstOf : guessOf)(family, shaped.body.length, shaped.maxTokens);
  const ok = await admit(c, account, a, lane, guess);
  if (!ok.ok) return (await countRefusal(lane, ok.kind), refuse(ok));

  const meters = meter();
  let code = 0;
  try {
    code = await forward({ stream, op, target: PROFILES[family], headers, body: shaped.body, meters });
  } finally {
    // Settled whatever happened to the stream: a call the caller walked away from still cost what it used.
    const u = code >= 200 && code < 300 ? meters.usage() : { input: 0, output: 0, cache_read: 0, cache_write: 0 };
    const micro = microOf(family, u);
    await settle(account, lane, ok.held, micro);
    await record(account, lane, family, ip, headers, shaped.flags, code, u, micro);
  }
}

/** Sends one call to Bedrock and its reply back as Bedrock gave it; the reply's status. */
async function forward({ stream, op, target, headers, body, meters }) {
  const upstream = `/model/${encodeURIComponent(target)}/${op}`;
  // Nothing else: Bedrock's own headers can pick a dearer service tier or a guardrail, billed but not metered here.
  const pass = Object.fromEntries(Object.entries(headers).filter(([k]) => k === "content-type" || k === "accept"));
  const res = await fetch(`https://${HOST}${upstream}`, { method: "POST", headers: signed(upstream, body, pass), body });
  const out = awslambda.HttpResponseStream.from(stream, {
    statusCode: res.status,
    headers: Object.fromEntries([...res.headers].filter(([k]) => k === "content-type" || k.startsWith("x-amzn-"))),
  });
  if (op === "invoke-with-response-stream" && res.ok) {
    try {
      for await (const chunk of res.body) {
        const b = Buffer.from(chunk);
        meters?.push(b);
        // The caller has gone: stop reading, so Bedrock stops writing what nobody reads.
        if (out.destroyed) break;
        out.write(b);
      }
    } catch (e) {
      // Bedrock dropped the stream partway: the caller sees it end short and retries, and what it used is still billed.
      console.error(e);
    }
  } else {
    const text = await res.text();
    if (op === "invoke" && res.ok) meters?.json(text);
    out.write(text);
  }
  out.end();
  return res.status;
}
