// Installs, landing visits and finished runs, written by install.sh, the landing page and the app,
// and read back by the dashboard at blpr.dev/admin (admin/index.html), which names each call as it
// did when this lived in Supabase. Writes are open to anyone and keep only what fits; every read
// checks the one dashboard password.
import { randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { daysAgo, get, getMany, put, query, today, update, without } from "./db.mjs";

const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : undefined);
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const fits = (x, n) => (x != null && JSON.stringify(x).length < n ? x : undefined);
const count = (x) => (Array.isArray(x) ? x.length : undefined);

export async function trackInstall({ os, arch, ok } = {}) {
  const at = new Date().toISOString();
  await put({ pk: "install", sk: `${at}#${randomInt(1e9)}`, at, os: clip(os, 40), arch: clip(arch, 40), ok: ok === true });
}

export async function trackVisit({ vid, path, referrer, country } = {}) {
  if (typeof vid !== "string" || !/^[0-9a-f-]{36}$/i.test(vid)) return;
  const now = new Date().toISOString();
  await update(
    `visit#${today()}`,
    vid,
    "SET views = if_not_exists(views, :zero) + :one, last_at = :now, first_at = if_not_exists(first_at, :now), #p = if_not_exists(#p, :path), referrer = if_not_exists(referrer, :ref), country = if_not_exists(country, :country)",
    { ":zero": 0, ":one": 1, ":now": now, ":path": clip(path, 200) ?? null, ":ref": clip(referrer, 300) ?? null, ":country": clip(country, 80) ?? null },
    undefined,
    { "#p": "path" },
  );
}

/** One finished run. What the app sends is whatever its report says; anything oversized is dropped, so the run still counts. */
export async function recordRun({ r } = {}) {
  if (!r || typeof r !== "object") return;
  const at = new Date().toISOString();
  const id = Date.now() * 1000 + randomInt(1000);
  const report = fits(r.report, 262144);
  const bill = report?.bill && typeof report.bill === "object" && !Array.isArray(report.bill) ? Object.values(report.bill) : null;
  await put({ pk: `runbody#${id}`, sk: "body", report: report === undefined ? undefined : JSON.stringify(report), log_tail: typeof r.log_tail === "string" ? r.log_tail.slice(-65536) : undefined });
  await put({
    pk: "run",
    sk: `${at}#${id}`,
    id,
    at,
    install_id: typeof r.install_id === "string" && /^[0-9a-f-]{36}$/.test(r.install_id) ? r.install_id : undefined,
    mapper_version: Number.isInteger(r.mapper_version) ? r.mapper_version : undefined,
    kind: clip(r.kind, 20),
    status: clip(r.status, 20) ?? "unknown",
    repo: clip(r.repo, 200),
    repo_commit: clip(r.repo_commit, 64),
    backend: clip(r.backend, 40),
    mode: clip(r.mode, 80),
    files: Number.isInteger(r.files) ? r.files : undefined,
    quick_s: num(r.quick_s),
    total_s: num(r.total_s),
    usd: num(r.usd),
    models: fits(r.models, 4096),
    // What the dashboard reads of the report, kept here so a list never loads one.
    problems: count(report?.check?.problems),
    quick_problems: count(report?.quickCheck?.problems),
    sections: count(report?.deepened),
    accepted: Array.isArray(report?.deepened) ? report.deepened.filter((s) => s?.accepted === true).length : undefined,
    tokens: bill ? bill.reduce((a, b) => a + (Number(b?.input) || 0) + (Number(b?.output) || 0) + (Number(b?.cacheRead) || 0), 0) : undefined,
  });
}

/* ── the dashboard ── */

export class NotAllowed extends Error {}

/** The stored password is scrypt `salt:hash` in hex (scripts/api/hash-password.mjs makes one). */
export async function allowed(pw) {
  const item = await get("admin", "pw");
  const [salt, hash] = (item?.hash ?? "").split(":");
  if (!salt || !hash || typeof pw !== "string") throw new NotAllowed("Not allowed");
  const want = Buffer.from(hash, "hex");
  const got = scryptSync(pw, Buffer.from(salt, "hex"), want.length);
  if (!timingSafeEqual(want, got)) throw new NotAllowed("Not allowed");
}

const same = (a, b) => (a ?? null) === (b ?? null);
const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = (v.length - 1) / 2;
  return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2;
};
const mean = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const top = (rows, key, n = 15) => {
  const by = new Map();
  for (const r of rows) {
    const k = r.key;
    if (!by.has(k)) by.set(k, new Set());
    by.get(k).add(r.visitor);
  }
  return [...by].map(([k, s]) => ({ [key]: k, visitors: s.size })).sort((a, b) => b.visitors - a.visitors).slice(0, n);
};

/** The updates a new blueprint went on to get: same machine, same repo, until a new blueprint of that repo was made there. */
function updatesOf(g, runs) {
  const next = runs.filter((n) => n.kind !== "update" && same(n.install_id, g.install_id) && same(n.repo, g.repo) && n.at > g.at).map((n) => n.at).sort()[0];
  return runs.filter((u) => u.kind === "update" && same(u.install_id, g.install_id) && same(u.repo, g.repo) && u.at > g.at && (!next || u.at < next));
}

const summary = (r) => without(r, "pk", "sk");

export async function overview({ pw } = {}) {
  await allowed(pw);
  const days = Array.from({ length: 30 }, (_, i) => daysAgo(29 - i));
  const [installs, runs, ...visitDays] = await Promise.all([query("install"), query("run").then((rs) => rs.map(summary)), ...days.map((d) => query(`visit#${d}`))]);
  const visits = visitDays.flatMap((vs, i) => vs.map((v) => ({ day: days[i], visitor: v.sk, views: Number(v.views) || 0, referrer: v.referrer, country: v.country })));
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const fresh = runs.filter((r) => r.kind !== "update");
  const osRows = new Map();
  for (const i of installs) {
    const k = `${i.os ?? "?"} ${i.arch ?? ""}`;
    const o = osRows.get(k) ?? { os: k, installs: 0, failed: 0 };
    if (i.ok) o.installs++;
    else o.failed++;
    osRows.set(k, o);
  }
  const versions = new Map();
  for (const r of fresh) {
    const k = r.mapper_version ?? null;
    if (!versions.has(k)) versions.set(k, []);
    versions.get(k).push(r);
  }
  return {
    installs: installs.filter((i) => i.ok).length,
    installs_30: installs.filter((i) => i.ok && i.at > since).length,
    installs_failed_30: installs.filter((i) => !i.ok && i.at > since).length,
    visitors_30: new Set(visits.map((v) => v.visitor)).size,
    views_30: visits.reduce((a, v) => a + v.views, 0),
    daily: days.map((day) => ({
      day,
      installs: installs.filter((i) => i.ok && i.at.startsWith(day)).length,
      installs_failed: installs.filter((i) => !i.ok && i.at.startsWith(day)).length,
      visitors: visits.filter((v) => v.day === day).length,
      views: visits.filter((v) => v.day === day).reduce((a, v) => a + v.views, 0),
      runs_ok: fresh.filter((r) => r.status === "ok" && r.at.startsWith(day)).length,
      runs_failed: fresh.filter((r) => r.status !== "ok" && r.at.startsWith(day)).length,
    })),
    referrers: top(visits.map((v) => ({ key: v.referrer || "direct", visitor: v.visitor })), "referrer"),
    countries: top(visits.map((v) => ({ key: v.country ?? "unknown", visitor: v.visitor })), "country"),
    os: [...osRows.values()].sort((a, b) => b.installs - a.installs),
    versions: [...versions]
      .map(([v, rs]) => {
        const ok = rs.filter((r) => r.status === "ok");
        return {
          mapper_version: v,
          runs: rs.length,
          failed: rs.length - ok.length,
          first_at: rs.map((r) => r.at).sort()[0],
          last_at: rs.map((r) => r.at).sort().at(-1),
          quick_s: median(ok.map((r) => r.quick_s)),
          total_s: median(ok.map((r) => r.total_s)),
          usd: mean(ok.map((r) => r.usd)),
          files: mean(ok.map((r) => r.files)),
          problems: mean(ok.map((r) => r.problems)),
        };
      })
      .sort((a, b) => (b.mapper_version ?? -1) - (a.mapper_version ?? -1)),
    runs_30: fresh.filter((r) => r.at > since).length,
    runs_failed_30: fresh.filter((r) => r.status !== "ok" && r.at > since).length,
    updates_30: runs.filter((r) => r.kind === "update" && r.at > since).length,
    usd_30: runs.filter((r) => r.at > since).reduce((a, r) => a + (r.usd ?? 0), 0),
    machines: new Set(runs.map((r) => r.install_id ?? null)).size,
    recent: fresh
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 200)
      .map((g) => {
        const u = updatesOf(g, runs);
        const row = without(g, "models", "problems", "quick_problems", "sections", "accepted", "tokens");
        return { ...row, updates: u.length, updates_usd: u.reduce((a, x) => a + (x.usd ?? 0), 0) };
      }),
  };
}

/** One blueprint's report and log, and its updates (with a log only for those that failed). */
export async function run({ pw, run_id } = {}) {
  await allowed(pw);
  const runs = (await query("run")).map(summary);
  const g = runs.find((r) => String(r.id) === String(run_id));
  if (!g) return null;
  const ups = updatesOf(g, runs).sort((a, b) => (a.at < b.at ? 1 : -1));
  const bodies = new Map((await getMany([g, ...ups].map((r) => ({ pk: `runbody#${r.id}`, sk: "body" })))).map((b) => [b.pk, b]));
  const body = (r) => bodies.get(`runbody#${r.id}`) ?? {};
  const parse = (s) => (s ? JSON.parse(s) : null);
  return {
    models: g.models ?? null,
    report: parse(body(g).report),
    log_tail: body(g).log_tail ?? null,
    updates: ups.map((u) => ({
      id: u.id, at: u.at, status: u.status, mapper_version: u.mapper_version ?? null, total_s: u.total_s ?? null, usd: u.usd ?? null,
      report: parse(body(u).report), log_tail: u.status !== "ok" ? (body(u).log_tail ?? null) : null,
    })),
  };
}

/** Every new blueprint of one repo, oldest first, with what the dashboard compares across generator versions. */
export async function repo({ pw, repo_name } = {}) {
  await allowed(pw);
  const runs = (await query("run")).map(summary);
  return runs
    .filter((g) => g.kind !== "update" && g.repo === repo_name)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .map((g) => ({
      id: g.id, at: g.at, install_id: g.install_id ?? null, mapper_version: g.mapper_version ?? null, status: g.status,
      repo_commit: g.repo_commit ?? null, files: g.files ?? null, quick_s: g.quick_s ?? null, total_s: g.total_s ?? null, usd: g.usd ?? null,
      tokens: g.tokens ?? null, quick_problems: g.quick_problems ?? null, problems: g.problems ?? null,
      sections: g.sections ?? null, accepted: g.accepted ?? null, updates: updatesOf(g, runs).length,
    }));
}

/** The credit's settings, each account's use over 30 days, and the spend per day (credit.mjs). */
export async function credit({ pw } = {}) {
  await allowed(pw);
  const days = Array.from({ length: 30 }, (_, i) => daysAgo(29 - i));
  const [config, accounts, spend, ...use] = await Promise.all([
    get("credit", "config"),
    query("account"),
    query("creditday", { from: days[0] }),
    ...days.map((d) => query(`use#${d}`)),
  ]);
  const none = () => ({ tab_usd_30: 0, gen_usd_30: 0, calls_30: 0, flagged_30: 0, last_at: null });
  const by = new Map();
  for (const u of use.flat()) {
    const d = by.get(u.sk) ?? none();
    d.tab_usd_30 += (Number(u.tab_micro) || 0) / 1e6;
    d.gen_usd_30 += (Number(u.gen_micro) || 0) / 1e6;
    d.calls_30 += (Number(u.tab_calls) || 0) + (Number(u.gen_calls) || 0);
    d.flagged_30 += Number(u.flagged) || 0;
    if (!d.last_at || u.last_at > d.last_at) d.last_at = u.last_at;
    by.set(u.sk, d);
  }
  return {
    config: config ? summary(config) : null,
    usd_30: spend.reduce((a, d) => a + (Number(d.usd) || 0), 0),
    accounts: accounts
      .map((a) => ({
        account: a.sk, login: a.login ?? null, gh_created: a.gh_created ?? null, first_at: a.first_at ?? null, machines: a.devices?.size ?? 0,
        allowed: !!a.allowed, blocked: !!a.blocked, uncapped: !!a.uncapped, note: a.note ?? null, ...(by.get(a.sk) ?? none()),
      }))
      .sort((a, b) => b.tab_usd_30 + b.gen_usd_30 - (a.tab_usd_30 + a.gen_usd_30))
      .slice(0, 200),
    daily: spend.map((d) => ({ day: d.sk, tab_usd: d.tab_usd ?? 0, gen_usd: d.gen_usd ?? 0 })),
    // The dashboard as deployed before accounts reads machines; empty, it still draws. Goes once blpr.dev/admin is redeployed.
    devices: [],
  };
}
