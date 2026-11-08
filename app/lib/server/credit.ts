import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Blueprint credit: Claude on Blueprint's own Bedrock instead of the reader's Claude Code, metered per
 * machine by the proxy (scripts/api/credit.mjs). The machine is a hash of the hardware's own id,
 * which this never stores, so reinstalling the app or clearing its data does not make it a new one.
 * Its token stays in this server's memory; a Claude tab gets only the relay's secret, which works
 * against this server alone and only while it runs (app/api/credit/relay).
 */

import { API_URL as CREDIT_URL } from "@/lib/server/api";

export { CREDIT_URL };

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

// Route handlers can be bundled apart, so what one sets the others must find on the global.
// `ready` is the last status this server saw, kept so a generator spawn can read it without waiting.
const state = ((globalThis as { __blueprintCredit?: { device?: string | null; token?: Promise<Registered>; secret: string; ready?: string | null } }).__blueprintCredit ??= {
  secret: randomBytes(32).toString("hex"),
});

type Registered = { token: string } | { reason: string };

export function deviceId() {
  if (state.device === undefined) {
    const h = hardwareId();
    state.device = h ? createHash("sha256").update(`bluprint-credit:${h}`).digest("hex") : null;
  }
  return state.device;
}

/** What a Claude tab presents to the relay; a new one each time this server starts. */
export const relaySecret = () => state.secret;

/** This machine's token, asked for once per server run; a refusal is asked again next time. */
export function deviceToken(): Promise<Registered> {
  state.token ??= (async (): Promise<Registered> => {
    const device = deviceId();
    if (!device) return { reason: "This machine has no id to meter the credit by." };
    const r = await fetch(`${CREDIT_URL}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const body = (await r?.json().catch(() => null)) as { token?: string; message?: string } | null;
    return body?.token ? { token: body.token } : { reason: body?.message ?? "Blueprint credit could not be reached." };
  })().then((t) => {
    if (!("token" in t)) state.token = undefined;
    return t;
  });
  return state.token;
}

async function file() {
  const { VAULT } = await import("@/lib/server/vault");
  return join(VAULT, "credit.json");
}

/** Whether the reader has turned the credit on; kept beside the vault so generation can read it. */
export async function creditOn() {
  try {
    return (JSON.parse(readFileSync(await file(), "utf8")) as { on?: boolean }).on === true;
  } catch {
    return false;
  }
}

export async function setCreditOn(on: boolean) {
  const f = await file();
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, JSON.stringify({ on }) + "\n");
  await creditStatus();
}

export interface CreditStatus {
  /** Whether this machine may use the credit at all; while it is switched off for everyone, only machines let in. */
  available: boolean;
  on: boolean;
  device: string | null;
  /** Tab tokens used in the open window, its size, and when it closes (null with none open). */
  used?: number;
  limit?: number;
  resets?: string | null;
  windowHours?: number;
  reason?: string;
}

export async function creditStatus(): Promise<CreditStatus> {
  const s = await askStatus();
  const t = await deviceToken();
  state.ready = s.available && s.on && "token" in t ? t.token : null;
  return s;
}

async function askStatus(): Promise<CreditStatus> {
  const on = await creditOn();
  const device = deviceId();
  const t = await deviceToken();
  if (!("token" in t)) return { available: false, on, device, reason: t.reason };
  const r = await fetch(`${CREDIT_URL}/status`, { headers: { authorization: `Bearer ${t.token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const s = (await r?.json().catch(() => null)) as { available?: boolean; used?: number; limit?: number; resets?: string | null; window_hours?: number } | null;
  if (!r?.ok || !s) return { available: false, on, device, reason: "Blueprint credit could not be reached." };
  return { available: !!s.available, on, device, used: s.used, limit: s.limit, resets: s.resets, windowHours: s.window_hours };
}

/**
 * What a generator run adds to its environment: with the credit on and open to this machine, the
 * generator's own Bedrock backend, pointed at the proxy's uncapped lane; otherwise nothing, and the
 * run stays on the reader's Claude Code. Read from the last status the page asked for (the status
 * bar asks as the app opens), so starting a run waits on nothing.
 */
export function creditEnv(): Record<string, string> {
  return state.ready ? { SLOP_BACKEND: "bedrock", SLOP_BEDROCK_URL: `${CREDIT_URL}/gen`, SLOP_BEDROCK_TOKEN: state.ready, AWS_REGION: "us-east-1" } : {};
}
