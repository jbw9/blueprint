// Who may use Blueprint credit: a GitHub account, checked here with GitHub itself. A machine id alone
// was never enough, since the app computes it and anyone can make one up; it stays only to hold an
// account to a few machines and a machine to one account. Signing in gives the machine a session,
// which it keeps; the session is swapped for access tokens that last 30 minutes, which the proxy
// checks without reading the table.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./credit.mjs";
import { del, get, put, refused, today, update } from "./db.mjs";

const ACCESS_SECONDS = 30 * 60;
const SESSION_DAYS = 90;

const hash = (s) => createHash("sha256").update(s).digest("hex");
const mac = (s) => createHmac("sha256", process.env.TOKEN_SECRET).update(s).digest("base64url");
const bearer = (headers) => (headers.authorization ?? "").replace(/^Bearer\s+/i, "");
const epoch = () => Math.floor(Date.now() / 1000);

/** The network an address is on: an IPv6 address by its /64, since one machine can rotate through all of that. */
export function network(ip) {
  const a = String(ip);
  if (!a.includes(":")) return a;
  const [head, tail = ""] = a.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${full.slice(0, 4).join(":")}::/64`;
}

/** The person behind a token the app got from GitHub's device flow. The token itself is not kept. */
async function githubUser(token) {
  if (typeof token !== "string" || !token || token.length > 512) return null;
  const r = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "blueprint-credit", "x-github-api-version": "2022-11-28" },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const u = r?.ok ? await r.json().catch(() => null) : null;
  return u?.id && u.type === "User" ? { id: `gh:${u.id}`, login: String(u.login), created: String(u.created_at) } : null;
}

/** `{github_token, device}` → a session for this machine, or why not. */
export async function signIn({ github_token, device } = {}, ip) {
  if (typeof device !== "string" || !/^[0-9a-f]{64}$/.test(device)) return { reason: "Not a device id." };
  const gh = await githubUser(github_token);
  if (!gh) return { reason: "GitHub didn't accept that sign-in. Try again." };
  const c = await config();
  if (!((Date.now() - Date.parse(gh.created)) / 86400_000 >= c.gh_min_age_days))
    return { reason: `Blueprint credit needs a GitHub account at least ${c.gh_min_age_days} days old.` };

  const [account, machine] = await Promise.all([get("account", gh.id), get("device", device)]);
  if (account?.blocked) return { reason: "Blueprint credit isn't available to this GitHub account." };
  const other = "This machine already uses Blueprint credit with another GitHub account.";
  if (machine?.account && machine.account !== gh.id) return { reason: other };
  const limit = account?.devices_per_account ?? c.devices_per_account;
  const full = `This GitHub account already uses Blueprint credit on ${limit} machines.`;
  const had = !!account?.devices?.has?.(device);

  // One free allowance per person: a network can only start a few new ones a day.
  if (!account) {
    try {
      await update(`ipreg#${network(ip)}`, today(), "SET n = if_not_exists(n, :zero) + :one, #ttl = :ttl",
        { ":zero": 0, ":one": 1, ":max": c.new_accounts_per_ip_day, ":ttl": epoch() + 2 * 86400 }, "attribute_not_exists(n) OR n < :max", { "#ttl": "ttl" });
    } catch (e) {
      if (refused(e)) return { reason: "Too many new Blueprint credit accounts from this network today." };
      throw e;
    }
  }

  const now = new Date().toISOString();
  try {
    await update("account", gh.id, "SET login = :l, gh_created = :c, first_at = if_not_exists(first_at, :now), last_at = :now ADD devices :d",
      { ":l": gh.login, ":c": gh.created, ":now": now, ":d": new Set([device]), ":dv": device, ":lim": limit },
      "attribute_not_exists(devices) OR contains(devices, :dv) OR size(devices) < :lim");
  } catch (e) {
    if (refused(e)) return { reason: full };
    throw e;
  }
  // Bound after the account, and only if no other account got there first.
  try {
    await update("device", device, "SET account = :a, #at = if_not_exists(#at, :now), ip = if_not_exists(ip, :ip)",
      { ":a": gh.id, ":now": now, ":ip": String(ip).slice(0, 64) }, "attribute_not_exists(account) OR account = :a", { "#at": "at" });
  } catch (e) {
    if (!refused(e)) throw e;
    if (!had) await update("account", gh.id, "DELETE devices :d", { ":d": new Set([device]) });
    return { reason: other };
  }

  const session = `s1.${randomBytes(32).toString("base64url")}`;
  await put({ pk: "session", sk: hash(session), account: gh.id, device, at: now, last_at: now, ttl: epoch() + SESSION_DAYS * 86400 });
  return { session, login: gh.login };
}

/** A session's next access token, or null once it has been signed out or has lapsed. */
export async function refresh(headers) {
  const s = bearer(headers);
  if (!s.startsWith("s1.")) return null;
  const row = await get("session", hash(s));
  // DynamoDB deletes an expired row up to days later; until then it is still gone.
  if (!row || Number(row.ttl) < epoch()) return null;
  // Kept alive by use, written at most hourly.
  if (Date.now() - Date.parse(row.last_at) > 3600_000)
    await update("session", row.sk, "SET last_at = :now, #ttl = :ttl", { ":now": new Date().toISOString(), ":ttl": epoch() + SESSION_DAYS * 86400 }, undefined, { "#ttl": "ttl" });
  const exp = epoch() + ACCESS_SECONDS;
  const payload = Buffer.from(JSON.stringify({ a: row.account, d: row.device, exp })).toString("base64url");
  return { token: `a1.${payload}.${mac(`a1.${payload}`)}`, exp };
}

export async function signOut(headers) {
  const s = bearer(headers);
  if (s.startsWith("s1.")) await del("session", hash(s));
}

/** The account and machine an access token was made for, while it lasts. */
export function accessOf(headers) {
  const [v, payload, sig] = bearer(headers).split(".");
  if (v !== "a1" || !payload || !sig) return null;
  const want = Buffer.from(mac(`a1.${payload}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return p.exp > epoch() && typeof p.a === "string" ? { account: p.a, device: p.d } : null;
  } catch {
    return null;
  }
}
