import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Blueprint credit: Claude on Blueprint's own Bedrock instead of the reader's Claude Code, for a
 * GitHub account signed in here, metered by the proxy (scripts/api). Signing in leaves a session in
 * credit.json, which only this user can read; the session buys access tokens that last 30 minutes
 * and stay in this server's memory. A Claude tab and the generator get only the relay's secret,
 * which works against this machine's Blueprint alone (app/api/credit/relay).
 */

import { api } from "@/lib/server/api";

/** Blueprint's GitHub OAuth app, which signs in by device code: its id is public, and it has no secret here. */
const GITHUB_CLIENT_ID = "Ov23li6hsQHhIxCkRrDT";

/** The id the operating system keeps for this machine, unchanged by reinstalling anything but the system. */
function hardwareId(): string | null {
  try {
    if (process.platform === "darwin")
      return execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" }).match(/"IOPlatformUUID" = "([^"]+)"/)?.[1] ?? null;
    if (process.platform === "win32")
      return execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8" }).match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1] ?? null;
    for (const f of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) if (existsSync(f)) return readFileSync(f, "utf8").trim() || null;
  } catch {
    // No id to be had: the credit is simply not offered.
  }
  return null;
}

type Access = { token: string; exp: number };

// Route handlers can be bundled apart, so what one sets the others must find on the global.
// `ready` is whether the last status this server saw let the credit run, kept so a generator
// spawn can read it without waiting; `origin` is where this server answers, from the page's ask.
const state = ((
  globalThis as {
    __blueprintCredit?: {
      secret?: Promise<string>;
      secretNow?: string;
      device?: string | null;
      access?: Access;
      refreshing?: Promise<Access | null>;
      pending?: { deviceCode: string; interval: number; until: number };
      promo?: { on: boolean; at: number };
      ready?: boolean;
      maps?: Meter;
      origin?: string;
    };
  }
).__blueprintCredit ??= {});

/** This machine, as the proxy keeps a GitHub account to a few of them: a hash of the hardware's id, which is never sent. */
function deviceId() {
  if (state.device === undefined) {
    const h = hardwareId();
    state.device = h ? createHash("sha256").update(`bluprint-credit:${h}`).digest("hex") : null;
  }
  return state.device;
}

/**
 * What a Claude tab or the generator presents to the relay. Kept in credit.json beside the session, which
 * can do more than it, so a generator still running when the app restarts (an update) still gets through.
 */
export function relaySecret() {
  state.secret ??= saved().then(async (s) => {
    if (s.relay) return s.relay;
    const relay = randomBytes(32).toString("hex");
    await save({ ...s, relay });
    return relay;
  });
  return state.secret;
}

/**
 * Where this server answers, as the page reached it; the relay is given as 127.0.0.1, which the
 * server listens on whatever the page called it (src-tauri/src/server.rs).
 */
export function relayAt(request: Request) {
  state.origin = `http://127.0.0.1:${new URL(request.url).port}`;
  return `${state.origin}/api/credit/relay`;
}

interface Saved {
  on?: boolean;
  /** Whether Claude moves to the reader's own Claude Code once the credit is used up; unset is yes. */
  fallback?: boolean;
  session?: string;
  login?: string;
  relay?: string;
}

async function file() {
  const { VAULT } = await import("@/lib/server/vault");
  return join(VAULT, "credit.json");
}

async function saved(): Promise<Saved> {
  try {
    return JSON.parse(readFileSync(await file(), "utf8")) as Saved;
  } catch {
    return {};
  }
}

/** Kept beside the vault so generation can read it; it holds the session, so only this user may read it. */
async function save(s: Saved) {
  const f = await file();
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, JSON.stringify(s) + "\n", { mode: 0o600 });
  chmodSync(f, 0o600);
}

/** Whether the reader has turned the credit on. */
export const creditOn = async () => (await saved()).on === true;
/** This machine's credit id while it is signed in, which names the GitHub account its run reports come from; null otherwise. */
export const signedInDevice = async () => ((await saved()).session ? deviceId() : null);

export async function setCreditOn(on: boolean) {
  await save({ ...(await saved()), on });
  await creditStatus();
}

export const setFallback = async (fallback: boolean) => save({ ...(await saved()), fallback });

/** The session's access token, swapped for a new one in its last five minutes; null when signed out. */
export async function accessToken(): Promise<string | null> {
  if (state.access && state.access.exp * 1000 - Date.now() > 300_000) return state.access.token;
  state.refreshing ??= refresh().finally(() => (state.refreshing = undefined));
  return (await state.refreshing)?.token ?? null;
}

/** Forgets the access token the proxy just refused, so the next call asks for another. */
export const dropAccess = () => void (state.access = undefined);

async function refresh(): Promise<Access | null> {
  const s = await saved();
  state.access = undefined;
  if (!s.session) return null;
  const r = await api("/token", { method: "POST", headers: { authorization: `Bearer ${s.session}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  // The session was signed out elsewhere or has lapsed: the reader signs in again.
  if (r?.status === 401) {
    await save({ on: s.on, fallback: s.fallback });
    return null;
  }
  const t = r?.ok ? ((await r.json().catch(() => null)) as Access | null) : null;
  if (t?.token) state.access = { token: t.token, exp: t.exp };
  return state.access ?? null;
}

/** Signing in, first half: GitHub's code for the reader to enter at its address. */
export async function startSignIn(): Promise<{ code: string; url: string; interval: number } | { reason: string }> {
  if (!GITHUB_CLIENT_ID) return { reason: "Blueprint credit's sign-in isn't set up yet." };
  if (!deviceId()) return { reason: "This machine has no id to keep the credit to." };
  const r = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { accept: "application/json" },
    body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const j = (r?.ok ? await r.json().catch(() => null) : null) as { device_code?: string; user_code?: string; verification_uri?: string; expires_in?: number; interval?: number } | null;
  if (!j?.device_code || !j.user_code || !j.verification_uri) return { reason: "GitHub could not be reached." };
  const interval = j.interval ?? 5;
  state.pending = { deviceCode: j.device_code, interval, until: Date.now() + (j.expires_in ?? 900) * 1000 };
  return { code: j.user_code, url: j.verification_uri, interval };
}

/**
 * Signing in, second half, asked every `interval` seconds until the reader has entered the code:
 * GitHub's token is shown to the proxy, which checks the account and gives this machine a session.
 * GitHub's token itself is not kept.
 */
export async function pollSignIn(): Promise<{ login: string } | { wait: number } | { reason: string }> {
  const p = state.pending;
  if (!p || Date.now() > p.until) {
    state.pending = undefined;
    return { reason: "That code has expired. Sign in again." };
  }
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json" },
    body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, device_code: p.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const j = (r?.ok ? await r.json().catch(() => null) : null) as { access_token?: string; error?: string; interval?: number } | null;
  // GitHub out of reach for a moment is asked again, as is a reader who has not entered the code yet.
  if (!j || j.error === "authorization_pending") return { wait: p.interval };
  if (j.error === "slow_down") return { wait: (p.interval = j.interval ?? p.interval + 5) };
  state.pending = undefined;
  if (!j.access_token) return { reason: j.error === "access_denied" ? "The sign-in was cancelled on GitHub." : "That code has expired. Sign in again." };

  const s = await api("/signin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ github_token: j.access_token, device: deviceId() }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  const b = (await s?.json().catch(() => null)) as { session?: string; login?: string; message?: string } | null;
  if (!b?.session || !b.login) return { reason: b?.message ?? "Blueprint credit could not be reached." };
  // Signing in is asking for the credit, so it is turned on.
  await save({ ...(await saved()), on: true, session: b.session, login: b.login });
  state.access = undefined;
  await creditStatus();
  return { login: b.login };
}

export async function signOut() {
  const s = await saved();
  if (s.session)
    await api("/signout", { method: "POST", headers: { authorization: `Bearer ${s.session}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  await save({ on: s.on, fallback: s.fallback });
  state.access = undefined;
  state.ready = false;
}

/** Spend in µ$ ($1 is 1,000,000) in a window, its cap (null for none), and when it closes (null with none open). */
export interface Meter {
  used: number;
  limit: number | null;
  resets: string | null;
}

/** Whether a window is full until it resets. */
export const usedUp = (m?: Meter) => !!m && m.limit != null && !!m.resets && Date.parse(m.resets) > Date.now() && m.used >= m.limit;

export interface CreditStatus {
  /** Whether the credit can run Claude here: signed in, and open to the account. */
  available: boolean;
  on: boolean;
  /** Whether Claude tabs move to the reader's own Claude Code once Session or Week is used up. */
  fallback: boolean;
  /** Whether the promotion is on for anyone, which is what a reader not signed in is offered. */
  promo: boolean;
  login: string | null;
  reason?: string;
  endsAt?: string | null;
  /** Claude tabs' 5-hour session and week, and map generation's week. */
  meters?: { session: Meter; week: Meter; maps: Meter };
}

/**
 * The credit's status asked once, if nothing has since this server started, so a run started before any
 * page asked (the welcome page has no status bar) still goes on the credit (creditEnv).
 */
export async function primeCredit(request: Request) {
  relayAt(request);
  if (state.ready === undefined) await creditStatus().catch(() => undefined);
}

export async function creditStatus(): Promise<CreditStatus> {
  const s = await askStatus();
  // Known before `ready` is, so a generator spawned then (creditEnv) is given it.
  state.secretNow = await relaySecret();
  state.ready = s.available && s.on;
  state.maps = s.meters?.maps;
  return s;
}

/** Whether the promotion is on, asked at most every five minutes, as the proxy caches it. */
async function promoOn() {
  if (state.promo && Date.now() - state.promo.at < 300_000) return state.promo.on;
  const r = await api("/promo", { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const j = (r?.ok ? await r.json().catch(() => null) : null) as { on?: boolean } | null;
  if (j) state.promo = { on: !!j.on, at: Date.now() };
  return !!j?.on;
}

async function askStatus(): Promise<CreditStatus> {
  const [token, promo] = await Promise.all([accessToken(), promoOn()]);
  // Read after the token, which clears a session the proxy no longer knows.
  const { on = false, fallback = true, session, login } = await saved();
  const away = { available: false, on, fallback, promo, login: session ? (login ?? null) : null };
  if (!session) return away;
  if (!token) return { ...away, reason: "Blueprint credit could not be reached." };
  const r = await api("/status", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const j = (r?.ok ? await r.json().catch(() => null) : null) as {
    available?: boolean;
    reason?: string;
    login?: string | null;
    ends_at?: string | null;
    meters?: { tab5h: Meter; tabweek: Meter; genweek: Meter };
  } | null;
  if (!j) return { ...away, reason: "Blueprint credit could not be reached." };
  return {
    available: !!j.available,
    on,
    fallback,
    promo,
    login: j.login ?? login ?? null,
    reason: j.reason,
    endsAt: j.ends_at ?? null,
    meters: j.meters && { session: j.meters.tab5h, week: j.meters.tabweek, maps: j.meters.genweek },
  };
}

/** What a new blueprint costs, about, per file in the repository: enough over runs seen to rarely fall short. */
const MICRO_PER_FILE = 50_000;

function filesIn(root: string) {
  try {
    return execFileSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 << 20, windowsHide: true })
      .split("\n")
      .filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * What a generator run adds to its environment: with the credit on and open to this account, the
 * generator's own Bedrock backend, pointed at the relay's `gen` lane, four calls at a time as the
 * proxy allows; otherwise nothing, and the run stays on the reader's Claude Code. So does a new
 * blueprint of `root` that would cost more than what is left of Maps, rather than stop halfway.
 * Read from the last status the page asked for (the status bar asks as the app opens), so starting
 * a run waits on nothing.
 */
export function creditEnv(root?: string): Record<string, string> {
  if (!state.ready || !state.origin || !state.secretNow) return {};
  const m = state.maps;
  if (m?.limit != null) {
    const used = m.resets && Date.parse(m.resets) > Date.now() ? m.used : 0;
    if (m.limit - used <= (root ? filesIn(root) * MICRO_PER_FILE : 0)) return {};
  }
  return { SLOP_BACKEND: "bedrock", SLOP_BEDROCK_URL: `${state.origin}/api/credit/relay/gen`, SLOP_BEDROCK_TOKEN: state.secretNow, SLOP_CONCURRENCY: "4", AWS_REGION: "us-east-1" };
}
