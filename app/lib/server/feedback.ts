import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api } from "@/lib/server/api";
import { readTelemetry } from "@/lib/server/telemetry";
import { VERSION } from "@/lib/server/update";

/**
 * Bug reports and feedback sent from this machine (scripts/api/admin.mjs, `sendFeedback`), read by the
 * admin dashboard. Each one sent is kept here beside the vault with the key the backend gave for it,
 * which is what lets the app ask that report's status later; nobody else can.
 */

export interface Sent {
  id: number;
  at: string;
  key: string;
  kind: "bug" | "feedback";
  message: string;
  images: number;
}

export interface Report extends Omit<Sent, "key"> {
  /** null while the backend can't be asked. */
  status: string | null;
  updated_at: string | null;
}

async function file() {
  const { VAULT } = await import("@/lib/server/vault");
  return join(VAULT, "feedback.json");
}

async function readSent(): Promise<Sent[]> {
  try {
    const s = JSON.parse(readFileSync(await file(), "utf8"));
    return Array.isArray(s) ? s : [];
  } catch {
    return [];
  }
}

export async function sendFeedback(f: { kind: "bug" | "feedback"; message: string; email?: string; images: string[] }) {
  const t = await readTelemetry();
  const r = await api("/rpc/bp_feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      f: {
        ...f,
        source: "app",
        // Which machine sent it ties it to that machine's runs, so only while run reports are on.
        install_id: t.off ? undefined : t.installId,
        app_version: VERSION ?? "source",
        os: `${process.platform} ${process.arch}`,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const out = (await r.json().catch(() => null)) as { ok?: boolean; id?: number; at?: string; key?: string; error?: string; message?: string } | null;
  if (!r.ok || !out?.ok || !out.id || !out.at || !out.key) throw new Error(out?.error ?? out?.message ?? "Couldn't send it just now. Try again.");
  const sent: Sent = { id: out.id, at: out.at, key: out.key, kind: f.kind, message: f.message.trim(), images: f.images.length };
  const path = await file();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify([sent, ...(await readSent())], null, 2) + "\n");
  return sent;
}

/** What this machine has sent, newest first, each with the status it has on the dashboard. */
export async function listFeedback(): Promise<Report[]> {
  const sent = await readSent();
  if (!sent.length) return [];
  const statuses = (await api("/rpc/bp_feedback_status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reports: sent.map(({ id, at, key }) => ({ id, at, key })) }),
    signal: AbortSignal.timeout(10_000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as Record<string, { status: string; updated_at: string | null }> | null;
  return sent.map((s) => ({
    id: s.id, at: s.at, kind: s.kind, message: s.message, images: s.images,
    status: statuses?.[s.id]?.status ?? null, updated_at: statuses?.[s.id]?.updated_at ?? null,
  }));
}
