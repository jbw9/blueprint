// Installs, landing visits and finished runs, written by install.sh, the landing page and the app,
// and read back by the dashboard at blpr.dev/admin (admin/index.html), which names each call as it
// did when this lived in Supabase. Writes are open to anyone and keep only what fits; every read
// checks the one dashboard password.
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { network } from "./auth.mjs";
import { config, status } from "./credit.mjs";
import { daysAgo, get, getMany, put, query, refused, today, update, without } from "./db.mjs";

/** When Blueprint launched. Everything before it was us testing, so the dashboard counts people from here. */
export const LAUNCH = "2026-11-09T08:00:00.000Z";

const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : undefined);
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const fits = (x, n) => (x != null && JSON.stringify(x).length < n ? x : undefined);
const count = (x) => (Array.isArray(x) ? x.length : undefined);

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * One run of install.sh, with where its IP is (geojs.io, as the landing page asks for its country).
 * It pings as it starts and as it ends, under one run id, so a start with no end is an install left
 * while it ran; its id is the machine's, kept across runs and shared with the app's launches. The end names the step it stopped at and why, and what it installed for them.
 * Installs from before this send one ping, with no id and no phase.
 */
export async function trackInstall({ id, run, phase, os, arch, ok, version, ci, step, reason, seconds, fixed, node } = {}, ip) {
  const at = new Date().toISOString();
  const geo = await fetch(`https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`, { signal: AbortSignal.timeout(2000) })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  await put({
    pk: "install", sk: `${at}#${randomInt(1e9)}`, at, os: clip(os, 40), arch: clip(arch, 40), ok: ok === true, version: clip(version, 20), ci: ci === true,
    id: typeof id === "string" && UUID.test(id) ? id : undefined, run: typeof run === "string" && UUID.test(run) ? run : undefined, phase: phase === "start" ? "start" : "end",
    step: clip(step, 20), reason: clip(reason, 120), seconds: num(seconds), node: clip(node, 20),
    fixed: Array.isArray(fixed) ? fixed.filter((f) => typeof f === "string").slice(0, 10).map((f) => f.slice(0, 20)) : undefined,
    ip: clip(ip, 45), country: clip(geo.country, 80), region: clip(geo.region, 80), city: clip(geo.city, 80), org: clip(geo.organization_name, 80),
  });
}

/** The app opened, at most once a day per install: under the id install.sh gave it, so an install can be followed to its first launch. Kept 400 days. */
export async function trackOpen({ install_id, version, os, arch, first, ci } = {}, ip) {
  if (typeof install_id !== "string" || !UUID.test(install_id)) return;
  const now = new Date().toISOString();
  await put({
    pk: `open#${today()}`, sk: install_id, at: now, version: clip(version, 20), os: clip(os, 40), arch: clip(arch, 40),
    first: first === true, ci: ci === true, net: network(ip), ttl: Math.floor(Date.now() / 1000) + 400 * 86400,
  });
}

/** One browser's day on blpr.dev: where it first came from that day, and whether it copied the install command. Kept 400 days. */
export async function trackVisit({ vid, path, referrer, country, region, source, medium, campaign, copied } = {}) {
  if (typeof vid !== "string" || !/^[0-9a-f-]{36}$/i.test(vid)) return;
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 400 * 86400;
  if (copied === true) {
    await update(`visit#${today()}`, vid, "SET copied = :t, last_at = :now, #ttl = :ttl", { ":t": true, ":now": now, ":ttl": ttl }, undefined, { "#ttl": "ttl" });
    return;
  }
  await update(
    `visit#${today()}`,
    vid,
    "SET #v = if_not_exists(#v, :zero) + :one, last_at = :now, first_at = if_not_exists(first_at, :now), #p = if_not_exists(#p, :path), referrer = if_not_exists(referrer, :ref), country = if_not_exists(country, :country), #region = if_not_exists(#region, :region), #src = if_not_exists(#src, :src), medium = if_not_exists(medium, :med), campaign = if_not_exists(campaign, :camp), #ttl = :ttl",
    {
      ":zero": 0, ":one": 1, ":now": now, ":path": clip(path, 200) ?? null, ":ref": clip(referrer, 300) ?? null, ":country": clip(country, 80) ?? null, ":region": clip(region, 80) ?? null,
      ":src": clip(source, 80) ?? null, ":med": clip(medium, 80) ?? null, ":camp": clip(campaign, 120) ?? null, ":ttl": ttl,
    },
    undefined,
    // VIEWS, PATH, REGION, SOURCE and TTL are DynamoDB reserved words.
    { "#v": "views", "#p": "path", "#region": "region", "#src": "source", "#ttl": "ttl" },
  );
}

/** One finished run. What the app sends is whatever its report says; anything oversized is dropped, so the run still counts. */
export async function recordRun({ r } = {}, ip) {
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
    // The machine's Blueprint credit id, sent while it is signed in: which GitHub account made the blueprint.
    device: typeof r.device === "string" && /^[0-9a-f]{64}$/.test(r.device) ? r.device : undefined,
    // Only so the dashboard can tell a machine on one of our networks (teamip) from a person's.
    net: ip ? network(ip) : undefined,
    app_version: clip(r.app_version, 20),
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

const IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha = (s) => createHash("sha256").update(s).digest("hex");
export const FEEDBACK_STATUS = ["pending", "in progress", "resolved", "closed"];

/**
 * A bug report or feedback, from the app's Feedback dialog (components/chrome/feedback.tsx) or the
 * landing page's contact form, which must give an email to be answered at. Up to three pictures,
 * each its own item since one item holds at most 400 KB; the sender shrinks them to fit. The sender
 * gets back a key, kept only as its hash here, that lets it read the report's status later.
 */
export async function sendFeedback({ f } = {}) {
  const message = typeof f?.message === "string" ? f.message.trim().slice(0, 8000) : "";
  const email = clip(f?.email, 200)?.trim() || undefined;
  const source = f?.source === "landing" ? "landing" : "app";
  if (!message) return { error: "Say what happened." };
  if (email && !EMAIL.test(email)) return { error: "That email doesn't look right." };
  if (source === "landing" && !email) return { error: "Add an email so we can write back." };
  const images = (Array.isArray(f.images) ? f.images : []).filter((s) => typeof s === "string" && s.length < 380_000 && IMAGE.test(s)).slice(0, 3);
  const at = new Date().toISOString();
  const id = Date.now() * 1000 + randomInt(1000);
  const key = randomBytes(24).toString("base64url");
  await Promise.all(images.map((data, i) => put({ pk: `feedbackimg#${id}`, sk: String(i), data })));
  await put({
    pk: "feedback",
    sk: `${at}#${id}`,
    id,
    at,
    source,
    kind: f.kind === "bug" ? "bug" : "feedback",
    status: "pending",
    message,
    email,
    install_id: typeof f.install_id === "string" && /^[0-9a-f-]{36}$/.test(f.install_id) ? f.install_id : undefined,
    app_version: clip(f.app_version, 20),
    os: clip(f.os, 80),
    images: images.length,
    key_hash: sha(key),
  });
  return { ok: true, id, at, key };
}

/** `{reports: [{id, at, key}]}` → the status of each the sender holds the key to, by id. */
export async function feedbackStatus({ reports } = {}) {
  const asked = (Array.isArray(reports) ? reports : [])
    .filter((r) => Number.isSafeInteger(r?.id) && typeof r.at === "string" && r.at.length < 40 && typeof r.key === "string")
    .slice(0, 100);
  const rows = await getMany(asked.map((r) => ({ pk: "feedback", sk: `${r.at}#${r.id}` })));
  const keyOf = new Map(asked.map((r) => [r.id, r.key]));
  return Object.fromEntries(
    rows.filter((r) => keyOf.has(r.id) && r.key_hash === sha(keyOf.get(r.id))).map((r) => [r.id, { status: r.status ?? "pending", updated_at: r.updated_at ?? null }]),
  );
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

/** The app version each machine ran last, from its runs: what is still in use, so how long the backend must keep answering it. */
function appsInUse(runs) {
  const last = new Map();
  for (const r of runs) if (!last.has(r.install_id ?? null) || last.get(r.install_id ?? null).at < r.at) last.set(r.install_id ?? null, r);
  const by = new Map();
  for (const r of last.values()) by.set(r.app_version ?? "unknown", (by.get(r.app_version ?? "unknown") ?? 0) + 1);
  return [...by].map(([version, machines]) => ({ version, machines })).sort((a, b) => b.machines - a.machines);
}

/**
 * Ours, not people's: GitHub accounts marked `team` on their account item, and any already signed in
 * before launch. The dashboard also leaves out CI's installs, browsers and machines here before
 * launch, and installs from a network this dashboard was opened from.
 */
const teamOf = (accounts) => new Set(accounts.filter((a) => a.team || (a.first_at && a.first_at < LAUNCH)).map((a) => a.sk));
const unique = (xs) => new Set(xs).size;
const sum = (xs) => xs.reduce((a, x) => a + (Number(x) || 0), 0);

/** People's visits, installs and blueprints since launch, each against what was left out as ours. */
export async function overview({ pw } = {}, ip) {
  await allowed(pw);
  // Whoever opens this page is us, and so is an install from their network.
  if (ip) await put({ pk: "teamip", sk: network(ip), at: new Date().toISOString() });
  const chart = Array.from({ length: 30 }, (_, i) => daysAgo(29 - i));
  const live = Array.from({ length: 400 }, (_, i) => daysAgo(i)).filter((d) => d >= LAUNCH.slice(0, 10)).reverse();
  const [allInstalls, allRuns, accounts, devices, nets, ...visitDays] = await Promise.all([
    query("install", { from: LAUNCH }),
    query("run").then((rs) => rs.map(summary)),
    query("account"),
    query("device"),
    query("teamip").then((ts) => new Set(ts.map((t) => t.sk))),
    ...live.map((d) => query(`visit#${d}`)),
  ]);
  const openDays = await Promise.all(live.map((d) => query(`open#${d}`)));

  // A browser here before launch was one of ours, and stays ours.
  const allVisits = visitDays.flatMap((vs, i) =>
    vs.map((v) => ({
      day: live[i], visitor: v.sk, first_at: v.first_at, views: Number(v.views) || 0, copied: !!v.copied, path: v.path,
      referrer: v.referrer, source: v.source, medium: v.medium, campaign: v.campaign, country: v.country, region: v.region,
    })),
  );
  const early = new Set(allVisits.filter((v) => v.first_at && v.first_at < LAUNCH).map((v) => v.visitor));
  const visits = allVisits.filter((v) => !early.has(v.visitor));

  const whose = (i) => (i.ci ? "ci" : i.team || (i.ip && nets.has(network(i.ip))) ? "us" : "people");
  // An install's start ping only counts as an install when no end came: one left while it ran.
  const ended = new Set(allInstalls.filter((i) => i.phase !== "start" && i.run).map((i) => i.run));
  const tries = allInstalls.filter((i) => whose(i) === "people");
  const left = tries.filter((i) => i.phase === "start" && !ended.has(i.run));
  const installs = tries.filter((i) => i.phase !== "start");
  const worked = installs.filter((i) => i.ok);
  const failed = installs.filter((i) => !i.ok);

  // An app is ours when the install that gave it its id was, or it opened on one of our networks.
  const ourIds = new Set(allInstalls.filter((i) => i.id && whose(i) !== "people").map((i) => i.id));
  const opens = openDays.flatMap((os, i) => os.map((o) => ({ ...o, day: live[i] }))).filter((o) => !o.ci && !ourIds.has(o.sk) && !(o.net && nets.has(o.net)));
  const openedIds = new Set(opens.map((o) => o.sk));
  // Each machine once, from its first install that worked: opened if the app opened after it.
  const firstWorked = new Map();
  for (const i of worked) if (i.id && !(firstWorked.get(i.id) <= i.at)) firstWorked.set(i.id, i.at);
  const openedAfter = new Set(opens.filter((o) => firstWorked.has(o.sk) && o.at >= firstWorked.get(o.sk)).map((o) => o.sk));

  // A machine is ours once it made a blueprint before launch, on one of our networks or accounts, or in a run marked `team`.
  const team = teamOf(accounts);
  const accountOf = new Map(devices.map((d) => [d.sk, d.account]));
  const ourRun = (r) => r.at < LAUNCH || r.team || (r.net && nets.has(r.net)) || team.has(accountOf.get(r.device));
  const ourMachines = new Set(allRuns.filter(ourRun).map((r) => r.install_id ?? null));
  const runs = allRuns.map((r) => ({ ...r, ours: r.at < LAUNCH || ourMachines.has(r.install_id ?? null) }));
  const people = runs.filter((r) => !r.ours);
  const fresh = people.filter((r) => r.kind !== "update");

  const osRows = new Map();
  for (const i of installs) {
    const k = `${i.os ?? "?"} ${i.arch ?? ""}`.trim();
    const o = osRows.get(k) ?? { os: k, installs: 0, failed: 0 };
    if (i.ok) o.installs++;
    else o.failed++;
    osRows.set(k, o);
  }
  const versions = new Map();
  for (const r of runs.filter((r) => r.kind !== "update")) {
    const k = r.mapper_version ?? null;
    if (!versions.has(k)) versions.set(k, []);
    versions.get(k).push(r);
  }
  const place = (x) => [x.region, x.country].filter(Boolean).join(", ") || "unknown";
  return {
    launch: LAUNCH,
    visitors: unique(visits.map((v) => v.visitor)),
    visits: visits.length,
    views: sum(visits.map((v) => v.views)),
    copied: unique(visits.filter((v) => v.copied).map((v) => v.visitor)),
    installs: worked.length,
    installs_failed: failed.length,
    installs_left: left.length,
    // Installs that went on to open the app; only installs since ids were sent can.
    installs_opened: openedAfter.size,
    installs_with_id: firstWorked.size,
    opened: openedIds.size,
    opened_first: unique(opens.filter((o) => o.first).map((o) => o.sk)),
    // Installs before IPs were kept have none, and are not guessed at.
    installers: unique(worked.filter((i) => i.ip).map((i) => i.ip)),
    machines: unique(people.map((r) => r.install_id ?? null)),
    blueprints: fresh.filter((r) => r.status === "ok").length,
    blueprints_failed: fresh.filter((r) => r.status !== "ok").length,
    updates: people.length - fresh.length,
    blueprints_usd: sum(people.map((r) => r.usd)),
    left_out: {
      installs_ci: allInstalls.filter((i) => whose(i) === "ci").length,
      installs_ours: allInstalls.filter((i) => whose(i) === "us").length,
      browsers: early.size,
      machines: ourMachines.size,
      runs: runs.filter((r) => r.ours && r.at >= LAUNCH).length,
    },
    daily: chart.map((day) => {
      const v = visits.filter((x) => x.day === day);
      const on = (x) => x.at.startsWith(day);
      return {
        day,
        visitors: v.length,
        copied: v.filter((x) => x.copied).length,
        views: sum(v.map((x) => x.views)),
        installs: worked.filter(on).length,
        installs_failed: failed.filter(on).length,
        installs_left: left.filter(on).length,
        opened: opens.filter((o) => o.day === day).length,
        runs_ok: fresh.filter((r) => r.status === "ok" && on(r)).length,
        runs_failed: fresh.filter((r) => r.status !== "ok" && on(r)).length,
      };
    }),
    // A tagged link (?utm_source= or ?ref=) names its source; otherwise the site the visitor came from.
    referrers: top(visits.map((v) => ({ key: v.source || v.referrer || "direct", visitor: v.visitor })), "referrer"),
    campaigns: top(visits.filter((v) => v.source || v.campaign).map((v) => ({ key: [v.source, v.medium, v.campaign].filter(Boolean).join(" / "), visitor: v.visitor })), "campaign"),
    pages: top(visits.map((v) => ({ key: v.path || "/", visitor: v.visitor })), "page"),
    countries: top(visits.map((v) => ({ key: v.country ?? "unknown", visitor: v.visitor })), "country"),
    regions: top(visits.filter((v) => v.region).map((v) => ({ key: place(v), visitor: v.visitor })), "place"),
    install_os: [...osRows.values()].sort((a, b) => b.installs - a.installs),
    install_places: top(worked.map((i) => ({ key: place(i), visitor: i.sk })), "place"),
    // Where installs stop: failures with no step are from before steps were sent.
    install_stops: top(failed.map((i) => ({ key: [i.step ?? "unknown", i.reason].filter(Boolean).join(": "), visitor: i.sk })), "stop"),
    install_fixed: top(installs.flatMap((i) => (i.fixed ?? []).map((f) => ({ key: f, visitor: i.sk }))), "fixed"),
    recent_installs: [...installs, ...left]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 100)
      .map((i) => ({
        at: i.at, ok: i.ok, left: i.phase === "start", os: i.os, arch: i.arch, version: i.version, ip: i.ip ?? null, org: i.org ?? null, city: i.city ?? null, region: i.region ?? null, country: i.country ?? null,
        step: i.step ?? null, reason: i.reason ?? null, seconds: i.seconds ?? null, fixed: i.fixed ?? [], node: i.node ?? null, opened: i.id ? opens.some((o) => o.sk === i.id && o.at >= i.at) : null,
      })),
    apps: appsInUse(people),
    // Every blueprint, ours too: what compares one generator version with the next.
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
    recent: runs
      .filter((r) => r.kind !== "update")
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 200)
      .map((g) => {
        const u = updatesOf(g, runs);
        const row = without(g, "models", "problems", "quick_problems", "sections", "accepted", "tokens", "device", "net");
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

/**
 * Blueprint credit (credit.mjs), at list price as it charges. People's use since launch: every account
 * not ours, whole, since none of them was here before; by model from their calls (req#, kept 30 days).
 * And the bill: everyone's spend, ours included, which is what Bedrock charges.
 */
export async function credit({ pw } = {}) {
  await allowed(pw);
  const days = Array.from({ length: 30 }, (_, i) => daysAgo(29 - i));
  const [c, accounts, spend, months, use, usage, life, devices, runs] = await Promise.all([
    config(),
    query("account"),
    query("creditday", { from: days[0] }),
    query("creditmonth"),
    Promise.all(days.map((d) => query(`use#${d}`))),
    Promise.all(days.map((d) => query(`usage#${d}`))),
    query("life"),
    query("device"),
    query("run"),
  ]);
  const team = teamOf(accounts);
  // An account made by hand to let someone in has no first_at until they sign in.
  const people = accounts.filter((a) => a.first_at && !team.has(a.sk));
  const calls = (await Promise.all(people.map((a) => query(`req#${a.sk}`, { from: LAUNCH })))).flat();
  const lifeOf = new Map(life.map((l) => [l.sk, l]));
  const lifetime = (l) => ({
    tab_usd: (Number(l?.tab_micro) || 0) / 1e6,
    gen_usd: (Number(l?.gen_micro) || 0) / 1e6,
    tab_tokens: Number(l?.tab_tok) || 0,
    gen_tokens: Number(l?.gen_tok) || 0,
    calls: (Number(l?.tab_calls) || 0) + (Number(l?.gen_calls) || 0),
    tab_calls: Number(l?.tab_calls) || 0,
    gen_calls: Number(l?.gen_calls) || 0,
    in_tok: Number(l?.in_tok) || 0, out_tok: Number(l?.out_tok) || 0, cr_tok: Number(l?.cr_tok) || 0, cw_tok: Number(l?.cw_tok) || 0,
    since: l?.first_at ?? null,
  });
  const together = (ls) => {
    const t = lifetime(null);
    for (const l of ls) for (const k of Object.keys(t)) if (k !== "since") t[k] += l[k];
    return t;
  };
  // Blueprints by GitHub account, through the machine each was made on.
  const accountOf = new Map(devices.map((d) => [d.sk, d.account]));
  const madeBy = new Map();
  for (const r of runs) {
    const a = r.device && accountOf.get(r.device);
    if (!a) continue;
    const m = madeBy.get(a) ?? { maps: 0, maps_failed: 0, updates: 0, map_report_usd: 0, repos: new Set(), last_map_at: null };
    if (r.kind === "update") m.updates++;
    else if (r.status === "ok") m.maps++;
    else m.maps_failed++;
    m.map_report_usd += Number(r.usd) || 0;
    if (r.repo) m.repos.add(r.repo);
    if (r.kind !== "update" && (!m.last_map_at || r.at > m.last_map_at)) m.last_map_at = r.at;
    madeBy.set(a, m);
  }
  // People first, then by what each has cost; each one's allowance this week, as the app shows it.
  const spent = (x) => { const l = lifetime(lifeOf.get(x.sk)); return l.tab_usd + l.gen_usd; };
  const listed = [...accounts].sort((a, b) => team.has(a.sk) - team.has(b.sk) || spent(b) - spent(a)).slice(0, 200);
  const nowMeters = new Map(await Promise.all(listed.map(async (a) => [a.sk, (await status(a.sk).catch(() => null))?.meters ?? null])));
  const none = () => ({ tab_usd_30: 0, gen_usd_30: 0, calls_30: 0, tokens_30: 0, flagged_30: 0, active_days_30: 0, active_7: false, last_at: null });
  const weekAgo = daysAgo(6);
  const tok = (u) => (Number(u.in_tok) || 0) + (Number(u.out_tok) || 0) + (Number(u.cr_tok) || 0) + (Number(u.cw_tok) || 0);
  const by = new Map();
  for (const u of use.flat()) {
    const d = by.get(u.sk) ?? none();
    d.tab_usd_30 += (Number(u.tab_micro) || 0) / 1e6;
    d.gen_usd_30 += (Number(u.gen_micro) || 0) / 1e6;
    d.calls_30 += (Number(u.tab_calls) || 0) + (Number(u.gen_calls) || 0);
    d.tokens_30 += tok(u);
    d.flagged_30 += Number(u.flagged) || 0;
    d.active_days_30++;
    if (u.pk.slice(4) >= weekAgo) d.active_7 = true;
    if (!d.last_at || u.last_at > d.last_at) d.last_at = u.last_at;
    by.set(u.sk, d);
  }

  // People's calls by model, counted as usage#<day> counts everyone's.
  const FIELDS = ["calls", "micro", "in_tok", "out_tok", "cr_tok", "cw_tok", "cw1h_tok", "flagged", "failed", "throttled"];
  const models = new Map();
  for (const q of calls) {
    const k = `${q.lane}#${q.family}`;
    const m = models.get(k) ?? Object.fromEntries([["lane", q.lane], ["family", q.family], ...FIELDS.map((f) => [f, 0])]);
    const one = {
      calls: 1, micro: q.micro, in_tok: q.in_tok, out_tok: q.out_tok, cr_tok: q.cr_tok, cw_tok: q.cw_tok, cw1h_tok: q.cw1h_tok,
      flagged: q.flags ? 1 : 0, failed: q.code >= 200 && q.code < 300 ? 0 : 1, throttled: q.code === 429 ? 1 : 0,
    };
    for (const f of FIELDS) m[f] += Number(one[f]) || 0;
    models.set(k, m);
  }
  // usage#<day> / refused: everyone's calls turned away, by why.
  const refusedBy = {};
  for (const u of usage.flat().filter((u) => u.sk === "refused"))
    for (const [k, v] of Object.entries(without(u, "pk", "sk", "ttl"))) refusedBy[k] = (refusedBy[k] ?? 0) + (Number(v) || 0);

  const month = today().slice(0, 7);
  return {
    config: c,
    people: { ...together(people.map((a) => lifetime(lifeOf.get(a.sk)))), accounts: people.length, active_7: people.filter((a) => by.get(a.sk)?.active_7).length },
    team_accounts: team.size,
    models: [...models.values()].map(({ micro, ...m }) => ({ ...m, usd: micro / 1e6 })).sort((a, b) => b.usd - a.usd),
    daily: days.map((day, i) => {
      const mine = use[i].filter((u) => !team.has(u.sk));
      return {
        day,
        tab_usd: mine.reduce((a, u) => a + (Number(u.tab_micro) || 0), 0) / 1e6,
        gen_usd: mine.reduce((a, u) => a + (Number(u.gen_micro) || 0), 0) / 1e6,
        tokens: mine.reduce((a, u) => a + tok(u), 0),
        active: mine.length,
        signups: people.filter((a) => a.first_at?.startsWith(day)).length,
        bill_usd: Number(spend.find((x) => x.sk === day)?.usd) || 0,
      };
    }),
    bill: {
      usd_month: Number(months.find((m) => m.sk === month)?.usd) || 0,
      usd_30: spend.reduce((a, d) => a + (Number(d.usd) || 0), 0),
      life: lifetime(lifeOf.get("all")),
    },
    refused: Object.entries(refusedBy).map(([k, n]) => ({ kind: k.replace("_", " · "), n })).sort((a, b) => b.n - a.n),
    accounts: listed.map((a) => {
      const m = madeBy.get(a.sk);
      return {
        account: a.sk, login: a.login ?? null, gh_created: a.gh_created ?? null, first_at: a.first_at ?? null, machines: a.devices?.size ?? 0, team: team.has(a.sk),
        allowed: !!a.allowed, blocked: !!a.blocked, uncapped: !!a.uncapped, note: a.note ?? null, ...(by.get(a.sk) ?? none()),
        life: lifetime(lifeOf.get(a.sk)),
        maps: m?.maps ?? 0, maps_failed: m?.maps_failed ?? 0, updates: m?.updates ?? 0, map_report_usd: m?.map_report_usd ?? 0,
        repos: m ? [...m.repos].slice(0, 50) : [], last_map_at: m?.last_map_at ?? null,
        meters: nowMeters.get(a.sk) ?? null,
      };
    }),
  };
}

/** Every bug report and piece of feedback, newest first, without its pictures. */
export async function feedback({ pw } = {}) {
  await allowed(pw);
  return (await query("feedback")).map((r) => without(r, "pk", "sk", "key_hash")).sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** One report's pictures, as the data URLs the sender sent. */
export async function feedbackImages({ pw, id } = {}) {
  await allowed(pw);
  if (!Number.isSafeInteger(Number(id))) return [];
  return (await query(`feedbackimg#${Number(id)}`)).sort((a, b) => Number(a.sk) - Number(b.sk)).map((i) => i.data);
}

/** Moves a report along; its sender sees the new status in the app. */
export async function setFeedbackStatus({ pw, id, at, status } = {}) {
  await allowed(pw);
  if (!Number.isSafeInteger(id) || typeof at !== "string" || !FEEDBACK_STATUS.includes(status)) return null;
  return update("feedback", `${at}#${id}`, "SET #s = :s, updated_at = :now", { ":s": status, ":now": new Date().toISOString() }, "attribute_exists(pk)", { "#s": "status" }).catch((e) => {
    if (refused(e)) return null;
    throw e;
  });
}
