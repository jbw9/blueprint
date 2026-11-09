import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api } from "@/lib/server/api";
import { VERSION } from "@/lib/server/update";

/**
 * Run reports for the admin dashboard (blpr.dev/admin, scripts/api/admin.mjs).
 * Each finished blueprint run sends what its report says, the end of its log and the
 * generator version, under an id that names this install and nothing else. On
 * unless turned off in Settings; the choice lives beside the vault so the
 * server, which sends them, can read it.
 */

interface Telemetry {
  installId: string;
  off?: boolean;
}

async function file() {
  const { VAULT } = await import("@/lib/server/vault");
  return join(VAULT, "telemetry.json");
}

export async function readTelemetry(): Promise<Telemetry> {
  const f = await file();
  try {
    const t = JSON.parse(readFileSync(f, "utf8")) as Telemetry;
    if (typeof t.installId === "string") return t;
  } catch {
    /* first run, or unreadable: start a new id */
  }
  const t = { installId: randomUUID() };
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, JSON.stringify(t) + "\n");
  return t;
}

export async function setTelemetry(on: boolean) {
  const t = await readTelemetry();
  writeFileSync(await file(), JSON.stringify({ ...t, off: on ? undefined : true }) + "\n");
}

const json = (path: string) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const tail = (path: string) => {
  try {
    return readFileSync(path, "utf8").split("\n").slice(-300).join("\n");
  } catch {
    return "";
  }
};

/** Send one finished run; never throws, never waits on the reader. */
export async function sendRun(dir: string, kind: "generate" | "update", status: string) {
  try {
    const t = await readTelemetry();
    if (t.off) return;
    const report = json(join(dir, "report.json"));
    const blueprint = json(join(dir, "blueprint.json"));
    const last = kind === "update" ? report?.updates?.at(-1) : null;
    const r = {
      install_id: t.installId,
      app_version: VERSION ?? "source",
      mapper_version: (last ?? report)?.mapperVersion ?? blueprint?.RUN?.mapperVersion,
      kind,
      status,
      repo: report?.repo ?? blueprint?.RUN?.repo,
      repo_commit: report?.commit ?? blueprint?.RUN?.commit,
      backend: report?.backend,
      mode: kind === "update" ? "update" : report?.mode,
      files: blueprint?.RUN?.files,
      quick_s: kind === "update" ? undefined : report?.elapsed?.quick,
      total_s: kind === "update" ? last?.seconds : report?.elapsed?.total,
      usd: kind === "update" ? last?.usd : report?.usd,
      models: report?.models ?? blueprint?.RUN?.models,
      report: kind === "update" ? last : report,
      log_tail: tail(join(dir, kind === "update" ? "update.log" : "generate.log")),
    };
    await api("/rpc/bp_record_run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ r }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* a report lost is fine; the run is the reader's, not ours */
  }
}
