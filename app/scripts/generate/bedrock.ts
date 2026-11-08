/**
 * One door to Claude on Bedrock, shaped after VisuLearn's src/lib/bedrock.ts:
 * InvokeModel with the native Anthropic body, default credential chain,
 * AWS_REGION. Adds what a batch pipeline needs and a chat app does not —
 * tools, a global concurrency cap, backoff on throttling, a disk cache, and
 * a running bill.
 *
 * The cache is the reproducibility story. Temperature 0 narrows a fresh sample
 * but does not pin it (and thinking calls cannot use it); the same request
 * served from disk is pinned. A re-run with no code changes is therefore
 * identical, and `--fresh` measures how far a new sample drifts.
 */

import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What this AWS account can invoke (probed 2026-10-22). The 5.x profiles are
 * listed in us-east-1 but every one answers AccessDeniedException.
 */
export const MODELS = {
  haiku: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  sonnet: "global.anthropic.claude-sonnet-4-6",
  opus: "global.anthropic.claude-opus-4-6-v1",
} as const;

/** The model without its routing prefix: `us.` and `global.` run the same model on the same request. */
const bare = (model: string) => model.replace(/^(us|eu|apac|global)\./, "");

/**
 * $ per million tokens through a `global.` profile, which Bedrock prices at
 * the list price; a geographic one (`us.`) costs about 10% more on input and
 * output. Times the tokens Bedrock reports, this is the bill to within its
 * rounding — Cost Explorer shows the same charge a day later, per service.
 */
const PRICE: Record<string, { in: number; out: number; cacheRead: number }> = {
  [bare(MODELS.haiku)]: { in: 1, out: 5, cacheRead: 0.1 },
  [bare(MODELS.sonnet)]: { in: 3, out: 15, cacheRead: 0.3 },
  [bare(MODELS.opus)]: { in: 5, out: 25, cacheRead: 0.5 },
};
const priceOf = (model: string) => {
  const p = PRICE[bare(model)];
  const k = model.startsWith("global.") ? 1 : 1.1;
  return { in: p.in * k, out: p.out * k, cacheRead: p.cacheRead * k };
};

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-east-1" });

/**
 * Blueprint credit (app/lib/server/credit.ts): a proxy that answers as Bedrock does, under this
 * machine's token. Called with fetch, not the SDK, which speaks HTTP/2 and the proxy does not; the
 * reply is Bedrock's own event stream, read here frame by frame.
 */
const CREDIT = process.env.SLOP_BEDROCK_URL;
async function* viaCredit(model: string, body: string): AsyncIterable<StreamEvent> {
  const res = await fetch(`${CREDIT}/model/${encodeURIComponent(model)}/invoke-with-response-stream`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.SLOP_BEDROCK_TOKEN}`, "content-type": "application/json", accept: "application/json" },
    body,
  });
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`${res.headers.get("x-amzn-errortype") ?? res.status}: ${j?.message ?? res.statusText}`);
  }
  let buf = Buffer.alloc(0);
  const reader = res.body.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    buf = Buffer.concat([buf, r.value]);
    while (buf.length >= 12 && buf.length >= buf.readUInt32BE(0)) {
      const total = buf.readUInt32BE(0);
      const end = 12 + buf.readUInt32BE(4);
      // Headers are name, type 7 (string), length, value; only the message type and an exception's name are wanted.
      const headers: Record<string, string> = {};
      for (let i = 12; i < end; ) {
        const name = buf.toString("utf8", i + 1, i + 1 + buf[i]);
        i += 1 + buf[i];
        const len = buf.readUInt16BE(i + 1);
        headers[name] = buf.toString("utf8", i + 3, i + 3 + len);
        i += 3 + len;
      }
      const payload = buf.toString("utf8", end, total - 4);
      buf = buf.subarray(total);
      if (headers[":message-type"] === "exception") throw new Error(`${headers[":exception-type"]}: ${(JSON.parse(payload) as { message?: string }).message ?? payload}`);
      const bytes = (JSON.parse(payload) as { bytes?: string }).bytes;
      if (bytes) yield { chunk: { bytes: Buffer.from(bytes, "base64") } };
    }
  }
}

export interface Tool {
  name: string;
  description: string;
  input_schema: object;
  strict?: boolean;
}

export type Block =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | { type: "thinking"; [k: string]: unknown };

export interface Message {
  role: "user" | "assistant";
  content: string | Block[];
}

export interface Reply {
  content: Block[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

export interface Request {
  model: string;
  system: string | Block[];
  messages: Message[];
  tools?: Tool[];
  maxTokens?: number;
  /** Turns on adaptive thinking at this effort (Sonnet/Opus only). Absent: temperature 0, no thinking. */
  effort?: "low" | "medium" | "high" | "max";
  /** Tags the bill, e.g. "summarize". */
  stage: string;
}

/* ── the bill ───────────────────────────────────────────────── */

/** `usd` is spent this run; `fullUsd` and the token counts are the whole work, replayed calls included, so a replayed blueprint still reports its size and price. */
export const bill: Record<string, { calls: number; cached: number; input: number; output: number; cacheRead: number; usd: number; fullUsd: number }> = {};

const charge = (stage: string, model: string, r: Reply, fromCache: boolean) => chargeUsage(stage, model, r.usage, fromCache);

/** Bills one call's tokens at the API list price, whichever backend made it, so the two compare. */
export function chargeUsage(stage: string, model: string, u: Reply["usage"], fromCache: boolean) {
  const b = (bill[stage] ??= { calls: 0, cached: 0, input: 0, output: 0, cacheRead: 0, usd: 0, fullUsd: 0 });
  b.calls++;
  const p = priceOf(model);
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const usd = (u.input_tokens * p.in + write * p.in * 1.25 + read * p.cacheRead + u.output_tokens * p.out) / 1e6;
  b.fullUsd += usd;
  // Tokens are the work the blueprint takes, so a replayed call counts too.
  b.input += u.input_tokens + write;
  b.output += u.output_tokens;
  b.cacheRead += read;
  if (fromCache) { b.cached++; return; }
  b.usd += usd;
}

/* ── cache, concurrency, backoff ────────────────────────────── */

let cacheDir: string | null = null;
let fresh = false;
export function cacheIn(dir: string, opts: { fresh?: boolean } = {}) {
  cacheDir = dir;
  fresh = Boolean(opts.fresh);
  mkdirSync(dir, { recursive: true });
}

/** Where a reply with this key is cached; `replay` false asks only where to write it (a --fresh run reads nothing). */
export function cacheFile(key: string, replay = true): string | null {
  if (cacheDir) used.add(`${key}.json`);
  return cacheDir && !(replay && fresh) ? join(cacheDir, `${key}.json`) : null;
}

/** Replies this run asked for, whether replayed or fresh: the cache a full run still needs. */
const used = new Set<string>();

/**
 * Drops the cached replies a full run never asked for. Their keys hash the
 * prompts and files they were made from, so once those change nothing can
 * ask for them again. Only after a whole blueprint, never a partial run (--roots,
 * an update), which leaves the other roots' replies unasked but still live.
 * Named files beside them (cut.json, summaries.json) are not replies and stay.
 */
export function sweepCache(): number {
  if (!cacheDir) return 0;
  let n = 0;
  for (const f of readdirSync(cacheDir))
    if (/^[0-9a-f]{64}\.json$/.test(f) && !used.has(f)) {
      rmSync(join(cacheDir, f), { force: true });
      n++;
    }
  return n;
}

/** The account or plan is out of usage: no retry or fallback helps for hours, so every catch on the way lets it through and the run stops. */
export class UsageLimitError extends Error {
  name = "UsageLimitError";
}

/** Which door the calls go through: an AWS account (default) or the reader's own Claude Code. */
export const BACKEND = process.env.SLOP_BACKEND === "claude-code" ? "claude-code" : "bedrock";

/**
 * Calls in flight at once, found rather than set: the repository decides how
 * many calls are ready at once and the account how many it takes, so a fixed
 * number was either the bottleneck of a big run or a wall of throttles. Each
 * call that comes back adds a little, about one lane per lane-full of calls;
 * a throttle halves it, once per pause, as every call in flight hits the same
 * limit together. SLOP_CONCURRENCY is the most it may reach.
 */
const MAX_LANES = Number(process.env.SLOP_CONCURRENCY ?? 24);
const HALVED_PER_MS = 15_000;
let lanes = MAX_LANES;
let halvedAt = 0;
let running = 0;
const queue: (() => void)[] = [];
const admit = () => {
  while (queue.length && running < Math.floor(lanes)) {
    running++;
    queue.shift()!();
  }
};
export async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running < Math.floor(lanes) && !queue.length) running++;
  else await new Promise<void>((r) => queue.push(r));
  try {
    const r = await fn();
    lanes = Math.min(MAX_LANES, lanes + 1 / Math.floor(lanes));
    return r;
  } finally {
    running--;
    admit();
  }
}

/** The account said too many: fewer calls at once from here, until replies show it takes more again. */
export function slowDown() {
  if (Date.now() - halvedAt < HALVED_PER_MS) return;
  halvedAt = Date.now();
  lanes = Math.max(1, Math.floor(lanes / 2));
  throttle.lanes = Math.min(throttle.lanes, lanes);
}

let coolUntil = 0;
/** Seconds of request time spent waiting out throttles, summed over calls — the account's quota, not the work — and the fewest lanes the run fell to. */
export const throttle = { waits: 0, seconds: 0, lanes: MAX_LANES };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = /Throttling|TooManyRequests|ServiceUnavailable|ModelNotReady|InternalServer|ModelError|timeout|ECONNRESET|socket hang up/i;

export async function invoke(req: Request): Promise<Reply> {
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: req.maxTokens ?? 16000,
    system: req.system,
    messages: req.messages,
    ...(req.tools ? { tools: req.tools, tool_choice: { type: "auto" } } : {}),
    ...(req.effort ? { thinking: { type: "adaptive" }, output_config: { effort: req.effort } } : { temperature: 0 }),
  };
  const json = JSON.stringify(body);
  // Keyed on one spelling of the model whatever the routing — the `us.` one
  // the first blueprints were cached under — so a routing switch replays them.
  const key = createHash("sha256").update(`us.${bare(req.model)}\n${json}`).digest("hex");
  const file = cacheDir ? join(cacheDir, `${key}.json`) : null;
  if (file) used.add(`${key}.json`);
  if (file && !fresh && existsSync(file)) {
    const r = JSON.parse(readFileSync(file, "utf8")) as Reply;
    charge(req.stage, req.model, r, true);
    return r;
  }

  const r = await slot(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        if (coolUntil > Date.now()) await sleep(coolUntil - Date.now());
        // Streamed, as VisuLearn does: a long author turn left a plain
        // request waiting minutes with nothing on the wire, and it timed out.
        if (CREDIT) return await assemble(viaCredit(req.model, json));
        const res = await client.send(
          new InvokeModelWithResponseStreamCommand({ modelId: req.model, contentType: "application/json", accept: "application/json", body: json }),
        );
        return await assemble(res.body!);
      } catch (e) {
        const msg = `${(e as Error).name}: ${(e as Error).message}`;
        // A daily cap does not lift in minutes; retrying only burns them.
        if (/per day/i.test(msg)) throw new UsageLimitError(`${req.stage} ${req.model}: daily token quota spent — ${msg}`);
        const throttled = /Throttling|TooManyRequests/i.test(msg);
        if (attempt >= (throttled ? 12 : 6) || !RETRYABLE.test(msg)) throw new Error(`${req.stage} ${req.model}: ${msg}`);
        const wait = Math.min(60_000, 2000 * 2 ** attempt) * (0.5 + Math.random());
        // A throttle is the account's quota, not this request: every call
        // waits it out, or the rest keep hitting the limit and burn retries.
        if (throttled) {
          slowDown();
          coolUntil = Math.max(coolUntil, Date.now() + wait);
          throttle.waits++;
          throttle.seconds += wait / 1000;
        }
        await sleep(wait);
      }
    }
  });
  charge(req.stage, req.model, r, false);
  if (file) writeFileSync(file, JSON.stringify(r));
  return r;
}

type StreamEvent = { chunk?: { bytes?: Uint8Array } };

/** The whole reply from its stream events, shaped exactly as a plain call returns it. */
async function assemble(stream: AsyncIterable<StreamEvent>): Promise<Reply> {
  const reply: Reply = { content: [], stop_reason: "", usage: { input_tokens: 0, output_tokens: 0 } };
  const json: Record<number, string> = {};
  for await (const e of stream) {
    if (!e.chunk?.bytes) continue;
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic stream events */
    const ev: any = JSON.parse(new TextDecoder().decode(e.chunk.bytes));
    if (ev.type === "message_start") reply.usage = { ...ev.message.usage };
    else if (ev.type === "content_block_start") reply.content[ev.index] = { ...ev.content_block };
    else if (ev.type === "content_block_delta") {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- block being built */
      const b: any = reply.content[ev.index];
      const d = ev.delta;
      if (d.type === "text_delta") b.text = (b.text ?? "") + d.text;
      else if (d.type === "input_json_delta") json[ev.index] = (json[ev.index] ?? "") + d.partial_json;
      else if (d.type === "thinking_delta") b.thinking = (b.thinking ?? "") + d.thinking;
      else if (d.type === "signature_delta") b.signature = (b.signature ?? "") + d.signature;
    } else if (ev.type === "content_block_stop" && json[ev.index] !== undefined) {
      // A reply cut off at max_tokens can end mid-JSON; the callers already
      // treat a max_tokens stop as a turn to redo, so its input is just empty.
      let input: unknown = {};
      try { input = json[ev.index] ? JSON.parse(json[ev.index]) : {}; } catch { /* cut off */ }
      (reply.content[ev.index] as { input: unknown }).input = input;
    } else if (ev.type === "message_delta") {
      reply.stop_reason = ev.delta.stop_reason ?? reply.stop_reason;
      if (ev.usage?.output_tokens != null) reply.usage.output_tokens = ev.usage.output_tokens;
    }
  }
  return reply;
}

/** Every tool call in a reply. */
export const callsOf = (r: Reply) =>
  r.content.flatMap((b) => (b.type === "tool_use" ? [b as Extract<Block, { type: "tool_use" }>] : []));

/**
 * What is wrong with a tool answer at the top level, or null. Models now and
 * then send an array as its JSON text (saas-starter's verify stage crashed on
 * one); that is unwrapped in place, anything else goes back as an error.
 */
function shapeOf(tool: Tool, input: Record<string, unknown>): string | null {
  const schema = tool.input_schema as { required?: string[]; properties?: Record<string, { type?: string }> };
  for (const k of schema.required ?? []) if (input?.[k] === undefined) return `Missing required field "${k}".`;
  for (const [k, p] of Object.entries(schema.properties ?? {})) {
    if (p.type !== "array" || input[k] === undefined) continue;
    if (typeof input[k] === "string") {
      try { input[k] = JSON.parse(input[k] as string); } catch { /* reported below */ }
    }
    if (!Array.isArray(input[k])) return `Field "${k}" must be an array, not ${typeof input[k]}.`;
  }
  return null;
}

/**
 * One structured answer: the model is asked to call `tool` once and nothing
 * else. Forced tool_choice is a 400 on the 5.5 models, so this asks, checks,
 * and asks again with the reason when the call is missing.
 */
export async function ask<T>(req: Omit<Request, "tools"> & { tool: Tool }): Promise<T> {
  if (BACKEND === "claude-code") return (await import("./claude-code")).ccAsk<T>(req);
  const messages = [...req.messages];
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await invoke({ ...req, messages, tools: [req.tool] });
    const call = callsOf(r).find((c) => c.name === req.tool.name);
    const wrong = call ? shapeOf(req.tool, call.input as Record<string, unknown>) : null;
    if (call && !wrong) return call.input as T;
    messages.push(
      { role: "assistant", content: r.content },
      call
        ? { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, is_error: true, content: `${wrong} Call ${req.tool.name} again with the corrected input.` }] }
        : { role: "user", content: `Answer by calling the ${req.tool.name} tool exactly once. stop_reason was ${r.stop_reason}.` },
    );
  }
  throw new Error(`${req.stage}: no ${req.tool.name} call after 3 attempts`);
}
