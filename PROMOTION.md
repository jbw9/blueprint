# Free Claude Code promotion — how it works

> **Status (2026-11-08):** `enabled: true`, `policy: "log"`, ends **2026-12-08 23:59:59 UTC** (read live from the `credit / config` item).
>
> Code: `app/scripts/api/credit.mjs` (metering), `policy.mjs` (call shape), `auth.mjs` (GitHub sign-in), `app/lib/server/credit.ts` (app side), `landing/app/promotion/page.tsx` (public terms).

---

## 1. The idea in one picture

```
Blueprint app ──► local relay ──► bluprint-api Lambda ──► Bedrock (Blueprint's AWS account)
 (Claude tab or     (relay secret,    shape → admit → forward → settle
  map generator)     30-min token)
```

- People get Claude Code **free, inside Blueprint only**, paid for by Blueprint's Bedrock.
- Claude Code runs in Bedrock mode; the Lambda answers exactly as Bedrock would, so neither Claude Code nor the generator needs to change.
- Every call is **shaped**, **admitted** against limits, **forwarded** byte for byte, then **settled** at what Bedrock says it actually used.

---

## 2. Who can use it

| Rule | Value | Where it's enforced |
|---|---|---|
| Sign-in | GitHub device flow (no secret in the app) | `auth.mjs` `signIn` |
| GitHub account age | ≥ **30 days** (`gh_min_age_days`) | `auth.mjs` |
| Account type | `User` only (no orgs/bots) | `githubUser` |
| Machines per GitHub account | **2** (`devices_per_account`) | conditional update on `account.devices` |
| GitHub accounts per machine | **1** | `device` item binds to the first account |
| New accounts per network per day | **5** (`new_accounts_per_ip_day`); IPv6 counted per /64 | `ipreg#<network>` |
| Session | 90 days, kept alive by use | `session` item |
| Access token | 30 minutes, HMAC-signed, checked without a DB read | `accessOf` |

The machine id is a SHA-256 of the OS hardware id (`IOPlatformUUID`, `MachineGuid`, `/etc/machine-id`). The raw id is never sent.

---

## 3. The two lanes

| Lane | What it is | Models | Windows |
|---|---|---|---|
| `tab` | Claude Code in a Blueprint tab | **Sonnet 5.5** or **Haiku 5.5**. A request for Opus is served by Sonnet. | 5-hour + weekly |
| `gen` | Blueprint's own map generation | Whichever family it asks for (Opus / Sonnet / Haiku 5.5) | weekly only |

Each lane has its own per-minute budget, so a map run never slows down a chat.

---

## 4. Rate limits

### Spend windows (per GitHub account)

| Window | Cap | Length | Starts |
|---|---|---|---|
| `tab5h`: the **5-hour session** | **$4** (`tab_usd_5h`) | 5 h (`window_hours`) | at the first call after the last window closed |
| `tabweek` | **$40** (`tab_usd_week`) | 168 h (`week_hours`) | at the first call |
| `genweek`: maps ("unlimited", fair use) | **$100** (`gen_usd_week`) | 168 h | at the first call |

### Throttles (short, retried automatically)

| Limit | Value | What the caller sees |
|---|---|---|
| Concurrent tab calls | **3** (`tab_inflight`) | 429 `ThrottlingException`, retry in 5 s |
| Concurrent gen calls | **4** (`gen_inflight`) | same |
| Tab spend per minute | **$1** (`usd_per_minute`) | 429, retry when the minute rolls over |
| Gen spend per minute | **$5** (`gen_usd_per_minute`) | same |

### Size limits (applied to every call)

| Limit | Value |
|---|---|
| Max output, tab | 32,000 tokens (`max_tokens`) |
| Max output, gen | 64,000 tokens (`gen_max_tokens`) |
| 1M-token context beta | always stripped |

### Global ceilings

| Ceiling | Value | Effect |
|---|---|---|
| Everyone's spend this calendar month | **$4,500** (`monthly_usd_ceiling`) | credit pauses for everyone until the 1st |
| AWS Budget (console) | $6,000/month, deny-Bedrock action at 80% ($4,800) | the backstop if the app ceiling ever fails |

Uncapped accounts still count toward the month, but the month's ceiling doesn't stop them.

---

## 5. The 5-hour session, step by step

1. **First message** → no open `tab5h` window → one opens (`started = now`) and is charged.
2. **Each later call** adds its cost, but only while `started` is less than 5 h ago **and** spend is under $4. This is a single conditional DynamoDB update, so concurrent calls can't overshoot together.
3. **Cap reached** → 429 `ServiceQuotaExceededException`, `x-should-retry: false`, with a message giving the reset time. Claude Code shows it immediately instead of retrying.
4. **5 h after `started`** → the window has closed; the next call opens a fresh one.
5. The weekly window runs in parallel. Both must have room for a call to go through.

**Notes**
- The window is anchored to the **first message**, not rolling. An idle stretch doesn't extend it.
- Settling is pinned to the window the call was charged to, so a call that finishes after a reset never bills the new window.
- What $4 buys: roughly **15–40 prompts** on Sonnet 5.5, about half a Claude Pro session.

---

## 6. Life of one call

| Step | What happens |
|---|---|
| **Shape** (`policy.mjs`) | Check it looks like Claude Code in Blueprint (`cc_version=` + Blueprint's appended prompt) or like the generator (only generator tools). Clamp `max_tokens`. Rewrite 4.x-era params the 5.5 models refuse (thinking budget → adaptive, forced tool → auto, drop `temperature`/`top_p`/`top_k`). |
| **Guess** | Prompt bytes ÷ 4 with a tenth treated as new input, plus up to 4,000 output tokens. Reserved up front. |
| **Admit** | In order: call slot → minute budget → monthly ceiling → day counter (admin only) → each window. Any refusal gives back everything reserved before it. |
| **Forward** | SigV4-signed to the tagged inference profile. Only `content-type`/`accept` are passed, so nobody can pick a pricier service tier or a guardrail. |
| **Meter** | Reads usage from the event stream as it passes. A stream cut short is billed by the characters that did arrive. |
| **Settle** | Moves every reservation from the guess to the real cost and frees the slot. A failed call settles at $0. |
| **Record** | `req#<account>` per call (30 days), `use#<day>` per account, `usage#<day>` per lane/model, refusal counts by reason. |

---

## 7. Pricing used for metering

Per million tokens, global profiles, 5.5 models (`PRICE` in `credit.mjs`):

| Model | Input | Output | Cache read | 5-min cache write | 1-h cache write |
|---|---|---|---|---|---|
| Haiku 5.5 | $0.10 | $0.50 | $0.01 | $0.125 | $0.20 |
| Sonnet 5.5 | $2.00 | $10.00 | $0.20 | $2.50 | $4.00 |
| Opus 5.5 (gen only) | $4.00 | $20.00 | $0.20 | $5.00 | $8.00 |

> These 5.5 prices are in the working tree; they aren't committed yet. The committed version still has the 4.x prices.

---

## 8. Expected costs

### Per call (Sonnet 5.5, a typical Claude Code turn)

| Part | Tokens | Cost |
|---|---|---|
| Cache read (context) | ~40K | $0.008 |
| Cache write (new turn) | ~5K | $0.0125 |
| Output | ~1.5K | $0.015 |
| **One model call** | | **≈ $0.035** |
| **One prompt** (5–10 tool round trips) | | **≈ $0.15–0.30** |

### Per person (worst case: hits every cap)

| Lane | Week | Month (~4.3 wk) |
|---|---|---|
| Tabs | $40 | ~$172 |
| Maps | $100 | ~$430 |
| **Max per account** | **$140** | **~$600** |

### Program-wide

| Scenario | Monthly Bedrock |
|---|---|
| 100 users, light (2 sessions/wk at ~$2, 1 map/mo at ~$12) | ~$2,900 |
| 100 users, typical-heavy (5 sessions/wk at ~$3) | ~$6,500 → **hits the $4,500 ceiling** in ~3 weeks |
| ~8 people maxing every cap | ~$4,500 → ceiling |
| **Hard cap** | **$4,500** (app), then $4,800 Budget deny |

- A mid-size map runs about **$12** (the $100/wk fair use is "about eight maps").
- Lambda, DynamoDB on-demand and data transfer are small next to Bedrock: a few dollars to low tens per month.
- The month resets on the 1st (UTC). Promo runs ~1 month, so **the total exposure is about $4,500**, plus whatever uncapped accounts spend.

> These are estimates from the caps and typical Claude Code token shapes. Check them against `creditday` / `creditmonth` on the admin page after the first week.

---

## 9. Avoiding problems

### Abuse

| Risk | Guard |
|---|---|
| Using the credit outside Blueprint (curl, other tools) | Shape checks in `policy.mjs`. In `log` mode it only flags (`req#… flags`); switch to `enforce` after reviewing a week of flags. It's a fence, not a lock: the small allowance is what really holds. |
| Many GitHub accounts for more credit | 30-day account age, 5 new accounts per network per day, 1 account per machine |
| One account on many machines | 2 machines max |
| Runaway scripts | 3–4 call slots, a $1 (tab) / $5 (gen) per-minute budget, output clamps |
| Pricier Bedrock options | Only `content-type`/`accept` headers forwarded; Opus never served to tabs |
| A bad actor | Set `blocked: true` on their `account / gh:<id>` item |

### Reliability

| Risk | Guard / action |
|---|---|
| Bedrock throttling under load | Raise Bedrock TPM quotas for the profiles (console) |
| Lambda concurrency spikes | Set a reserved concurrency (console) |
| Network blips mid-stream | Caller retries; used tokens are still billed honestly |
| A crashed call holding a slot | Slot leases expire after 15 min |
| Config edits | Read at most every 30 s per Lambda copy, so changes land within ~30 s |

### Money

- **Two ceilings:** app at $4,500, AWS Budget deny at $4,800. The app one fails gracefully with a clear message. The Budget one cuts Bedrock off the function entirely.
- **Uncapped accounts** (the owner) bypass the monthly ceiling. Keep that list short.
- **Watch first:** daily spend (`creditday`), refusal counts by reason, flagged calls.

---

## 10. Levers (edit `credit / config` in the DynamoDB console)

| Key | Default | Use |
|---|---|---|
| `enabled` | false | master switch |
| `ends_at` | null | ISO end time; also shown on blpr.dev/promotion via `GET /promo` |
| `policy` / `gen_policy` | "log" / null | `"enforce"` refuses out-of-shape calls |
| `tab_usd_5h`, `tab_usd_week`, `gen_usd_week` | 4, 40, 100 | allowances (null = no cap) |
| `window_hours`, `week_hours` | 5, 168 | window lengths |
| `tab_inflight`, `gen_inflight` | 3, 4 | concurrency |
| `usd_per_minute`, `gen_usd_per_minute` | 1, 5 | burst limits |
| `monthly_usd_ceiling` | 4500 | global stop |
| `gh_min_age_days`, `devices_per_account`, `new_accounts_per_ip_day` | 30, 2, 5 | sign-up gates |

Per account (`account / gh:<id>`): any of the limits above, or `uncapped`, `allowed` (let in while the credit is off or has ended), `blocked`.

---

## 11. What users see

| Situation | Message / behavior |
|---|---|
| Session or week used up | "Your Blueprint credit for Claude Code is used up for now. It opens again at …" |
| Maps used up for the week | "This week's Blueprint credit for maps is used up." |
| Month's ceiling hit | "Blueprint credit has run out for this month. Switch to your own Claude Code in Settings." |
| Promo over | "Blueprint's free Claude Code promotion has ended." |
| Spending fast | Calls slow down for a minute (automatic retry) |
| Setting: *Switch to my Claude Code when it runs out* | Falls back to the user's own Claude plan; without one, tabs wait for the reset |

---

## 12. Still open before/at launch

- [ ] AWS Budget $6,000/mo with the deny-Bedrock action (console)
- [ ] Bedrock TPM quotas + Lambda concurrency (console)
- [ ] Mark the owner's `account / gh:<id>` as `uncapped` + `allowed`
- [ ] After ~1 week of reading `req#` flags: `policy` → `"enforce"`
- [ ] Commit the 5.5 price change in `credit.mjs` / `policy.mjs` / `claude.rs` and redeploy the Lambda
- [ ] Remove the `devices: []` shim in `admin.mjs` once the admin page is redeployed
