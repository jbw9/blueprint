"use client";

import { invoke } from "@tauri-apps/api/core";
import { Fragment, useCallback, useEffect, useState } from "react";
import { DIALOG, Field, INPUT, Overlay } from "@/components/ui/dialog";
import { keys } from "@/components/ui/button";
import { AgentIcon, CLAUDE, useInstalled } from "@/components/agent/agents";
import { PanelHead } from "@/components/ui/panel";
import { cn } from "@/lib/client/utils";
import { followTheme, onOpenSettings, readSettings, saveSettings, useSettings, type Ground, type Settings, type Theme } from "@/lib/client/settings";
import { useMac } from "@/lib/client/platform";
import { onCreditChanged, percent, pollSignIn, readCredit, resetsAt, setCredit, signOut, startSignIn, type Credit } from "@/lib/client/credit";

/**
 * Settings, as a dialog over the blueprint. There is little to set: the theme,
 * the agent new tabs open into, where Claude Code is when it was not found by
 * itself, which model it runs, and what the blueprint is drawn on. Every change is
 * saved as it is made, so there is nothing to confirm and nothing to undo.
 */

const THEMES: { value: Theme; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const GROUNDS: { value: Ground; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "dots", label: "Dots" },
  { value: "squares", label: "Squares" },
];

type Found = { path: string; version: string | null } | null;

/** One choice of a row of them. */
const SEGMENT =
  "cursor-pointer px-3.5 py-1 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  // What is on screen is what is saved: there is no draft to keep in step.
  const draft = useSettings();
  // undefined while looking.
  const [found, setFound] = useState<Found | undefined>(undefined);
  const agents = [CLAUDE, ...useInstalled()];
  const mac = useMac();

  const detect = useCallback((claudePath: string) => {
    setFound(undefined);
    invoke<Found>("claude_detect", { configured: claudePath.trim() || null })
      .then(setFound)
      .catch(() => setFound(null));
  }, []);

  useEffect(
    () =>
      onOpenSettings(() => {
        setOpen(true);
        detect(readSettings().claudePath);
      }),
    [detect],
  );

  // Mounted for the app's whole life, so this keeps the page on the saved theme.
  useEffect(followTheme, []);

  if (!open) return null;
  const close = () => {
    tidy();
    setOpen(false);
  };
  // Typing keeps its spaces until the field is left, so a trim never moves the caret.
  const set = (next: Partial<Settings>) => saveSettings({ ...readSettings(), ...next });
  const tidy = () => {
    const now = readSettings();
    set({ claudePath: now.claudePath.trim(), model: now.model.trim() });
  };

  return (
    <Overlay onClose={close}>
      <form
        role="dialog"
        aria-label="Settings"
        onSubmit={(e) => {
          e.preventDefault();
          close();
        }}
        className={cn(DIALOG, "max-w-[520px]")}
      >
        <PanelHead
          title="Settings"
          right={
            <button
              type="submit"
              aria-label="Close"
              title="Close (Esc)"
              className="-mr-1.5 -mt-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center text-muted-slate hover:bg-surface-container hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
                <path d="m4.5 4.5 7 7m0-7-7 7" />
              </svg>
            </button>
          }
        />
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-5 py-5">
          <Field group label="Theme" hint="Classic is the landing page's cobalt ink. Light and Dark are plain.">
            <div role="radiogroup" aria-label="Theme" className="inline-flex border border-border-gray p-0.5">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={draft.theme === t.value}
                  onClick={() => set({ theme: t.value })}
                  className={cn(
                    SEGMENT,
                    draft.theme === t.value ? "bg-accent text-on-accent" : "text-muted-slate hover:text-ink",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
          <Field group label="Background" hint="What the blueprint is drawn on.">
            <div role="radiogroup" aria-label="Background" className="inline-flex border border-border-gray p-0.5">
              {GROUNDS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  role="radio"
                  aria-checked={draft.ground === g.value}
                  onClick={() => set({ ground: g.value })}
                  className={cn(
                    SEGMENT,
                    draft.ground === g.value ? "bg-accent text-on-accent" : "text-muted-slate hover:text-ink",
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </Field>
          <Field
            group
            label="Default agent"
            hint={`What a tab opens into when the app opens one for you: ${keys(mac, "`")}, ${keys(mac, "T", { shift: true })}, the title bar, or the first in the + menu. Blueprint context goes to Claude either way.`}
          >
            <div role="radiogroup" aria-label="Default agent" className="inline-flex border border-border-gray p-0.5">
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={draft.agent === a.id}
                  onClick={() => set({ agent: a.id })}
                  className={cn(
                    SEGMENT, "flex items-center gap-1.5",
                    draft.agent === a.id ? "bg-accent text-on-accent" : "text-muted-slate hover:text-ink",
                  )}
                >
                  <AgentIcon id={a.id} />
                  {a.label}
                </button>
              ))}
            </div>
          </Field>
          <Field group label="Dev server" hint="Start a project's dev server when it opens, and show the running app in a Preview tab.">
            <div role="radiogroup" aria-label="Dev server" className="inline-flex border border-border-gray p-0.5">
              {[
                { value: true, label: "Start it" },
                { value: false, label: "Leave it" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={draft.devServer === o.value}
                  onClick={() => set({ devServer: o.value })}
                  className={cn(
                    SEGMENT,
                    draft.devServer === o.value ? "bg-accent text-on-accent" : "text-muted-slate hover:text-ink",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Claude Code" hint="Leave blank to find it automatically.">
            <input
              value={draft.claudePath}
              onChange={(e) => set({ claudePath: e.target.value })}
              onBlur={() => {
                tidy();
                detect(draft.claudePath);
              }}
              placeholder={found?.path ?? "~/.local/bin/claude"}
              spellCheck={false}
              className={INPUT}
            />
            <div className="mt-1.5 flex items-baseline gap-3 font-mono text-[11.5px]">
              {found === undefined ? (
                <span className="text-faint">Looking…</span>
              ) : found ? (
                <span className="truncate text-accent">
                  ✓ {found.path}
                  {found.version ? ` (${found.version})` : ""}
                </span>
              ) : (
                <span className="text-clay-ink">
                  {draft.claudePath.trim() ? "Nothing at that path." : "Not found — install Claude Code, or enter its path."}
                </span>
              )}
              <button
                type="button"
                onClick={() => detect(draft.claudePath)}
                className="ml-auto shrink-0 cursor-pointer text-accent hover:underline"
              >
                Detect again
              </button>
            </div>
          </Field>
          <Field label="Model" hint="Blank uses Claude Code's default. An alias like sonnet or opus, or a full model id.">
            <input
              value={draft.model}
              onChange={(e) => set({ model: e.target.value })}
              onBlur={tidy}
              placeholder="default"
              spellCheck={false}
              className={INPUT}
            />
          </Field>
          <Field
            group
            label="Claude Code dictation"
            hint="Hold Control+Option (⌃⌥), or Space in a Claude tab, and speak into Claude's prompt. Transcribed by Anthropic at no cost to your usage; needs a claude.ai sign-in, not Bedrock or an API key."
          >
            <div role="radiogroup" aria-label="Claude Code dictation" className="inline-flex border border-border-gray p-0.5">
              {[
                { value: true, label: "On" },
                { value: false, label: "As in Claude Code" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={draft.voice === o.value}
                  onClick={() => set({ voice: o.value })}
                  className={cn(
                    SEGMENT,
                    draft.voice === o.value ? "bg-accent text-on-accent" : "text-muted-slate hover:text-ink",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
          <Field
            group
            label="Skills and web research"
            hint="Claude loads skills and searches or reads the web without asking each time. Plan mode always does, and still never edits files."
          >
            <div role="radiogroup" aria-label="Skills and web research" className="inline-flex border border-border-gray p-0.5">
              {[
                { value: true, label: "Without asking" },
                { value: false, label: "As in Claude Code" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={draft.research === o.value}
                  onClick={() => set({ research: o.value })}
                  className={cn(
                    SEGMENT,
                    draft.research === o.value ? "bg-accent text-on-accent" : "text-muted-slate hover:text-ink",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
          <BlueprintCredit />
          <p className="text-[12px] text-faint">Claude Code changes apply to Claude tabs opened from now on.</p>
          <Field
            group
            label="On-device dictation"
            hint="Hold Control+Option (⌃⌥) in a field in the app, or for Claude's prompt where Claude Code dictation isn't available. Runs on this machine, for any sign-in; nothing is sent anywhere."
          >
            <OnDevice />
          </Field>
          <Field
            group
            label="Saved sign-ins"
            hint="Sites you signed in to in the Preview when Claude asked. Blueprint keeps their sign-in cookies, never your password. Forget signs you out."
          >
            <SignIns />
          </Field>
          <Field group label="Media while dictating" hint="Pauses Music and Spotify, and mutes everything else, while you hold ⌃⌥; all of it comes back when you let go.">
            <div role="radiogroup" aria-label="Media while dictating" className="inline-flex border border-border-gray p-0.5">
              {[
                { value: true, label: "Quiet it" },
                { value: false, label: "Leave it" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={draft.quietMedia === o.value}
                  onClick={() => set({ quietMedia: o.value })}
                  className={cn(
                    SEGMENT,
                    draft.quietMedia === o.value ? "bg-accent text-on-accent" : "text-muted-slate hover:text-ink",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
          <Field
            group
            label="Run reports"
            hint="When a blueprint finishes, Blueprint sends the Blueprint team how long it took, what it cost, the repository's name and the end of its log, so the mapping keeps getting better. Never your code."
          >
            <RunReports />
          </Field>
        </div>
      </form>
    </Overlay>
  );
}

/**
 * Blueprint credit (lib/server/credit.ts): Claude on Blueprint's own Bedrock in place of the user's
 * Claude Code, for a GitHub account signed in here. Offered while the promotion is on; once signed
 * in, its three windows show as Claude Code's /usage shows its own.
 */
function BlueprintCredit() {
  const [c, setC] = useState<Credit | null>(null);
  // GitHub's code while the reader enters it, or why signing in stopped.
  const [signin, setSignin] = useState<{ code: string; url: string; interval: number } | { reason: string } | null>(null);
  useEffect(() => {
    const read = () => void readCredit().then(setC);
    read();
    return onCreditChanged(read);
  }, []);
  useEffect(() => {
    if (!signin || !("code" in signin)) return;
    let stop = false;
    let t: ReturnType<typeof setTimeout>;
    const poll = (wait: number) => {
      t = setTimeout(async () => {
        const p = await pollSignIn().catch(() => ({ wait }));
        if (stop) return;
        if ("login" in p) setSignin(null);
        else if ("reason" in p) setSignin({ reason: p.reason });
        else poll(p.wait);
      }, wait * 1000);
    };
    poll(signin.interval);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [signin]);
  if (!c || (!c.login && !c.promo)) return null;

  const begin = async () => {
    const r = await startSignIn().catch(() => ({ reason: "Blueprint could not start the sign-in." }));
    setSignin(r);
    if ("code" in r) void invoke("preview_external", { url: r.url }).catch(() => window.open(r.url, "_blank"));
  };
  const meters = c.available && c.meters ? ([["Session", c.meters.session], ["Week", c.meters.week], ["Maps", c.meters.maps]] as const) : [];
  return (
    <Field
      group
      label="Blueprint credit"
      hint={`${c.promo ? "Claude Code included, free for a limited time. " : ""}Claude tabs and new blueprints run on Blueprint's Claude instead of your own Claude Code, only inside Blueprint. Making blueprints has no limit. Once Session or Week is full, new Claude tabs use your own Claude Code until it resets.`}
    >
      {c.login ? (
        <>
          {c.available && (
            <div role="radiogroup" aria-label="Blueprint credit" className="inline-flex border border-border-gray p-0.5">
              {[
                { value: true, label: "Use Blueprint credit" },
                { value: false, label: "Use my Claude Code" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={c.on === o.value}
                  onClick={() => {
                    setC({ ...c, on: o.value });
                    void setCredit(o.value);
                  }}
                  className={cn(SEGMENT, c.on === o.value ? "bg-accent text-on-accent" : "text-muted-slate hover:text-ink")}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {meters.length > 0 && (
            <div className="mt-2.5 grid grid-cols-[auto_6rem_auto_1fr] items-center gap-x-3 gap-y-1 font-mono text-[11.5px]">
              {meters.map(([label, m]) => {
                const used = percent(m);
                const at = resetsAt(m);
                return (
                  <Fragment key={label}>
                    <span className="text-ink">{label}</span>
                    <span className="h-1 bg-border-gray">
                      <span className="block h-full bg-accent" style={{ width: `${used ?? 0}%` }} />
                    </span>
                    <span className="text-ink">{used == null ? "no limit" : `${used}% used`}</span>
                    <span className="text-faint">{at ? `resets ${at}` : ""}</span>
                  </Fragment>
                );
              })}
            </div>
          )}
          {c.reason && <p className="mt-1.5 text-[12px] text-clay-ink">{c.reason}</p>}
          <p className="mt-2 font-mono text-[11.5px] text-faint">
            Signed in as @{c.login} ·{" "}
            <button type="button" onClick={() => void signOut()} className="cursor-pointer text-accent hover:underline">
              Sign out
            </button>
          </p>
        </>
      ) : signin && "code" in signin ? (
        <div className="font-mono text-[11.5px]">
          <span className="select-all text-[15px] tracking-[0.15em] text-ink">{signin.code}</span>
          <p className="mt-1 text-muted-slate">
            Enter this code at{" "}
            <a href={signin.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {signin.url.replace(/^https:\/\//, "")}
            </a>
            . Waiting for GitHub…{" "}
            <button type="button" onClick={() => setSignin(null)} className="cursor-pointer text-accent hover:underline">
              Cancel
            </button>
          </p>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => void begin()} className={cn(SEGMENT, "border border-border-gray text-ink hover:border-accent")}>
            Sign in with GitHub
          </button>
          {signin && <p className="mt-1.5 text-[12px] text-clay-ink">{signin.reason}</p>}
        </>
      )}
    </Field>
  );
}

/** Whether finished runs are reported (lib/server/telemetry.ts); kept by the server, which sends them. */
function RunReports() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/telemetry")
      .then((r) => r.json())
      .then((t: { on: boolean }) => setOn(t.on), () => setOn(null));
  }, []);
  const choose = (value: boolean) => {
    setOn(value);
    void fetch("/api/telemetry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: value }) });
  };
  return (
    <div role="radiogroup" aria-label="Run reports" className="inline-flex border border-border-gray p-0.5">
      {[
        { value: true, label: "Send" },
        { value: false, label: "Don't send" },
      ].map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={on === o.value}
          onClick={() => choose(o.value)}
          className={cn(SEGMENT, on === o.value ? "bg-accent text-on-accent" : "text-muted-slate hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type ModelStatus = { model: "missing" | "downloading" | "ready"; bytes: number; total: number; error: string | null };

/** The speech model for on-device dictation (src-tauri/src/dictate.rs): fetched once, kept until removed. */
function OnDevice() {
  const [s, setS] = useState<ModelStatus | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const read = useCallback(() => {
    invoke<ModelStatus>("dictate_status").then(setS, (e) => setFailed(String(e)));
  }, []);
  useEffect(() => {
    read();
  }, [read]);
  // Polled only while it downloads, for the progress and for when it lands.
  useEffect(() => {
    if (s?.model !== "downloading") return;
    const t = setInterval(read, 1000);
    return () => clearInterval(t);
  }, [s?.model, read]);
  const act = (cmd: string) => invoke(cmd).then(read, (e) => setFailed(String(e)));
  const mb = (n: number) => Math.round(n / 1e6);
  if (!s) return <span className="font-mono text-[11.5px] text-faint">{failed ?? "Looking…"}</span>;
  return (
    <div className="flex items-baseline gap-3 font-mono text-[11.5px]">
      {s.model === "ready" ? (
        <span className="text-accent">✓ Parakeet v3, {mb(s.total)} MB, on this machine</span>
      ) : s.model === "downloading" ? (
        <span className="text-ink">
          Downloading… {mb(s.bytes)} of {mb(s.total)} MB
        </span>
      ) : (
        <span className={s.error || failed ? "text-clay-ink" : "text-faint"}>
          {s.error ?? failed ?? `Needs its speech model, ${mb(s.total)} MB, downloaded once.`}
        </span>
      )}
      {s.model === "missing" ? (
        <button type="button" onClick={() => act("dictate_download")} className="ml-auto shrink-0 cursor-pointer text-accent hover:underline">
          {s.bytes ? "Resume download" : "Download"}
        </button>
      ) : (
        <button type="button" onClick={() => act("dictate_remove")} className="ml-auto shrink-0 cursor-pointer text-faint hover:text-ink">
          {s.model === "ready" ? "Remove" : "Stop"}
        </button>
      )}
    </div>
  );
}

type Kept = { global: string[]; projects: Record<string, string[]> };

/** The sign-ins the preview keeps (src-tauri/src/signins.rs): for all projects, then each project's own. */
function SignIns() {
  const [kept, setKept] = useState<Kept | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const read = useCallback(() => {
    invoke<Kept>("signin_list").then(setKept, (e) => setFailed(String(e)));
  }, []);
  useEffect(read, [read]);
  if (!kept) return <span className="font-mono text-[11.5px] text-faint">{failed ?? "Looking…"}</span>;
  const rows = [
    ...kept.global.map((site) => ({ site, root: null as string | null, where: "All projects" })),
    ...Object.entries(kept.projects).flatMap(([root, sites]) =>
      sites.map((site) => ({ site, root, where: root.split("/").filter(Boolean).pop() ?? root })),
    ),
  ];
  if (!rows.length) return <span className="font-mono text-[11.5px] text-faint">None yet.</span>;
  return (
    <ul className="flex flex-col gap-1 font-mono text-[11.5px]">
      {rows.map((r) => (
        <li key={`${r.root ?? ""}:${r.site}`} className="flex items-baseline gap-3">
          <span className="truncate text-ink">{r.site}</span>
          <span className="truncate text-faint" title={r.root ?? undefined}>
            {r.where}
          </span>
          <button
            type="button"
            onClick={() => invoke("signin_forget", { root: r.root, site: r.site }).then(read, (e) => setFailed(String(e)))}
            className="ml-auto shrink-0 cursor-pointer text-faint hover:text-ink"
          >
            Forget
          </button>
        </li>
      ))}
      {failed ? <li className="text-clay-ink">{failed}</li> : null}
    </ul>
  );
}
