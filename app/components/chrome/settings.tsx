"use client";

import { invoke } from "@tauri-apps/api/core";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DIALOG, Field, INPUT, Overlay, Segmented, Switch } from "@/components/ui/dialog";
import { cn } from "@/lib/client/utils";
import { Button } from "@/components/ui/button";
import { AgentIcon, CLAUDE, useInstalled } from "@/components/agent/agents";
import { PanelClose, PanelHead } from "@/components/ui/panel";
import { followTheme, onOpenSettings, readSettings, saveSettings, useSettings, type Ground, type Settings, type ThemeChoice } from "@/lib/client/settings";
import { useDesktop } from "@/lib/client/platform";
import { FeedbackForm } from "@/components/chrome/feedback";
import { onCreditChanged, percent, pollSignIn, readCredit, resetsAt, setCredit, setFallback, signOut, startSignIn, type Credit } from "@/lib/client/credit";

/**
 * Settings, as a dialog over the blueprint, in groups: how it looks, Claude Code,
 * dictation, the Preview, and what is sent to Blueprint, with Feedback last for
 * reporting a bug. Every change is saved as it is made, so there is nothing to
 * confirm and nothing to undo. Outside the desktop app (a page framed in a Preview)
 * only the look applies, so only it and Feedback show.
 */

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

const GROUNDS: { value: Ground; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "dots", label: "Dots" },
  { value: "squares", label: "Squares" },
];

type Found = { path: string; version: string | null } | null;

/** Opens a page in the reader's own browser, not a Preview tab. */
export const external = (url: string) => void invoke("preview_external", { url }).catch(() => window.open(url, "_blank"));

/**
 * GitHub's device sign-in, as two steps: the code, then the page it goes on.
 * Shown bare, the code read as something GitHub had sent rather than something
 * to type in. It is copied as it shows, where the webview allows it.
 */
export function GitHubCode({ code, url, onCancel }: { code: string; url: string; onCancel: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => void navigator.clipboard.writeText(code).then(() => setCopied(true), () => {}), [code]);
  useEffect(copy, [copy]);
  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      <div>
        <p className="text-ink">1. Copy this code</p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="select-all border border-border-strong bg-card px-3 py-1.5 font-mono text-[20px] tracking-[0.2em] text-ink">{code}</span>
          <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
        </div>
      </div>
      <div>
        <p className="text-ink">2. Paste it on GitHub and authorize Blueprint</p>
        <div className="mt-1.5 flex items-center gap-2">
          <Button variant="primary" onClick={() => external(url)}>
            Open GitHub
          </Button>
          <span className="font-mono text-[11.5px] text-faint">{url.replace(/^https:\/\//, "")}</span>
        </div>
      </div>
      <p className="text-muted-slate">
        Waiting for GitHub…{" "}
        <button type="button" onClick={onCancel} className="cursor-pointer text-accent hover:underline">
          Cancel
        </button>
      </p>
    </div>
  );
}

/** A group of settings under its name; only the one picked in the list shows, but all stay mounted so none redraws as it loads. */
function Group({ title, shown, children }: { title: Section; shown: Section; children: React.ReactNode }) {
  return (
    <section aria-label={title} hidden={title !== shown} className="flex animate-[section-in_.26s_cubic-bezier(.2,.7,.2,1)] flex-col">
      <h3 className="mb-2 font-display text-[24px] leading-tight text-ink">{title}</h3>
      {children}
    </section>
  );
}

const SECTIONS = ["Appearance", "Interface", "Dictation", "About", "Feedback"] as const;
type Section = (typeof SECTIONS)[number];
const BROWSER: readonly Section[] = ["Appearance", "Feedback"];
const isSection = (s?: string): s is Section => SECTIONS.includes(s as Section);

/** Each section's glyph in the list, drawn on a 16 square as the app's others are. */
const GLYPHS: Record<Section, React.ReactNode> = {
  Appearance: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
    </>
  ),
  Interface: (
    <>
      <rect x="2.5" y="3" width="11" height="10" />
      <path d="M2.5 6.5h11" />
    </>
  ),
  Dictation: (
    <>
      <rect x="6" y="2" width="4" height="7" rx="2" />
      <path d="M4 8a4 4 0 0 0 8 0M8 12v2" />
    </>
  ),
  About: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.5v3.5M8 5.2v.1" />
    </>
  ),
  Feedback: <path d="M2.5 3.5h11v7H8l-3 2.5v-2.5H2.5z" />,
};

/** The sections down the left. The highlight on the one in front slides to the next one picked. */
function SectionList({ names, section, onPick }: { names: readonly Section[]; section: Section; onPick: (s: Section) => void }) {
  const list = useRef<HTMLElement>(null);
  const [at, setAt] = useState<{ top: number; height: number } | null>(null);
  const [slides, setSlides] = useState(false);
  useLayoutEffect(() => {
    const b = list.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!b) return;
    setAt({ top: b.offsetTop, height: b.offsetHeight });
    const frame = requestAnimationFrame(() => setSlides(true));
    return () => cancelAnimationFrame(frame);
  }, [section]);
  return (
    <nav ref={list} aria-label="Settings sections" className="relative flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto px-3 pb-3 pt-1">
      {at ? (
        <span
          aria-hidden
          className={cn("absolute inset-x-3 top-0 rounded bg-surface-container", slides && "transition-[transform,height] duration-[260ms] ease-[cubic-bezier(.2,.7,.2,1)]")}
          style={{ height: at.height, transform: `translateY(${at.top}px)` }}
        />
      ) : null}
      {names.map((name) => (
        <button
          key={name}
          type="button"
          aria-current={name === section}
          onClick={() => onPick(name)}
          className={cn(
            "relative z-10 flex h-10 cursor-pointer items-center gap-2.5 rounded px-3 text-left text-[14px] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
            name === section ? "text-ink" : "text-on-surface-variant hover:text-ink",
          )}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {GLYPHS[name]}
          </svg>
          {name}
        </button>
      ))}
    </nav>
  );
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("Appearance");
  // What is on screen is what is saved: there is no draft to keep in step.
  const draft = useSettings();
  // undefined while looking.
  const [found, setFound] = useState<Found | undefined>(undefined);
  const agents = [CLAUDE, ...useInstalled()];
  const desktop = useDesktop();

  const detect = useCallback((claudePath: string) => {
    setFound(undefined);
    invoke<Found>("claude_detect", { configured: claudePath.trim() || null })
      .then(setFound)
      .catch(() => setFound(null));
  }, []);

  useEffect(
    () =>
      onOpenSettings((at) => {
        setOpen(true);
        setSection(isSection(at) ? at : "Appearance");
        if (desktop) detect(readSettings().claudePath);
      }),
    [detect, desktop],
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
      <div role="dialog" aria-label="Settings" className={`${DIALOG} h-[580px] max-w-[800px]`}>
        <PanelHead title="Settings" right={<PanelClose onClick={close} />} />
        <div className="flex min-h-0 flex-1">
          <SectionList names={desktop ? SECTIONS : BROWSER} section={section} onPick={setSection} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-9 pb-8 pt-1">
            <Group title="Appearance" shown={section}>
              <Field group label="Theme">
                <Segmented label="Theme" value={draft.theme} options={THEMES} onChange={(theme) => set({ theme })} />
              </Field>
              <Field group label="Background">
                <Segmented label="Background" value={draft.ground} options={GROUNDS} onChange={(ground) => set({ ground })} />
              </Field>
            </Group>
            {desktop ? (
              <>
                <Group title="Interface" shown={section}>
                  <BlueprintCredit />
                  <Field stack label="Claude Code">
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
                    <div className="mt-2 flex items-baseline gap-3 text-[12.5px]">
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
                  <Field stack label="Model">
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
                    label="Skills and web research"
                  >
                    <Segmented
                      label="Skills and web research"
                      value={draft.research}
                      options={[
                        { value: true, label: "Without asking" },
                        { value: false, label: "As in Claude Code" },
                      ]}
                      onChange={(research) => set({ research })}
                    />
                  </Field>
                  {agents.length > 1 ? (
                    <Field
                      group
                      label="Default agent"
                    >
                      <Segmented
                        label="Default agent"
                        value={draft.agent}
                        options={agents.map((a) => ({
                          value: a.id,
                          label: (
                            <>
                              <AgentIcon id={a.id} />
                              {a.label}
                            </>
                          ),
                        }))}
                        onChange={(agent) => set({ agent })}
                      />
                    </Field>
                  ) : null}
                  <Field group label="Preview">
                    <Segmented
                      label="Preview"
                      value={draft.devServer}
                      options={[
                        { value: true, label: "Start it" },
                        { value: false, label: "Leave it" },
                      ]}
                      onChange={(devServer) => set({ devServer })}
                    />
                  </Field>
                  <Field
                    group
                    stack
                    label="Saved sign-ins"
                  >
                    <SignIns />
                  </Field>
                </Group>
                <Group title="Dictation" shown={section}>
                  <Field
                    group
                    label="Claude Code dictation"
                  >
                    <Segmented
                      label="Claude Code dictation"
                      value={draft.voice}
                      options={[
                        { value: true, label: "On" },
                        { value: false, label: "As in Claude Code" },
                      ]}
                      onChange={(voice) => set({ voice })}
                    />
                  </Field>
                  <Field
                    group
                    stack
                    label="On-device dictation"
                  >
                    <OnDevice />
                  </Field>
                  <Field group label="Media while dictating">
                    <Segmented
                      label="Media while dictating"
                      // Unset until the first dictation asks; until then nothing is quieted.
                      value={draft.quietMedia ?? false}
                      options={[
                        { value: true, label: "Quiet it" },
                        { value: false, label: "Leave it" },
                      ]}
                      onChange={(quietMedia) => set({ quietMedia })}
                    />
                  </Field>
                </Group>
                <Group title="About" shown={section}>
                  <Field group label="Version">
                    <Version />
                  </Field>
                  <Field group label="Usage reports">
                    <RunReports />
                  </Field>
                </Group>
              </>
            ) : null}
            <FeedbackForm shown={section === "Feedback"} />
          </div>
        </div>
      </div>
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
    let t: ReturnType<typeof setTimeout>;
    let gone = false;
    // A status that could not be read (the server restarting) is asked again, not taken as no credit.
    const read = () => {
      clearTimeout(t);
      void readCredit().then((next) => {
        if (gone) return;
        if (next) setC(next);
        else t = setTimeout(read, 3000);
      });
    };
    read();
    const off = onCreditChanged(read);
    return () => {
      gone = true;
      clearTimeout(t);
      off();
    };
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
    if ("code" in r) external(r.url);
  };
  const meters = c.available && c.on && c.meters ? ([["Session", c.meters.session], ["Week", c.meters.week], ["Blueprints", c.meters.maps]] as const) : [];
  return (
    <Field
      group
      stack
      label="Blueprint credit"
    >
      {c.login ? (
        <>
          {c.available && (
            <Segmented
              label="Blueprint credit"
              value={c.on}
              options={[
                { value: true, label: "Use Blueprint credit" },
                { value: false, label: "Use my Claude Code" },
              ]}
              onChange={(on) => {
                setC({ ...c, on });
                void setCredit(on);
              }}
            />
          )}
          {meters.length > 0 && (
            <div className="mt-3 max-w-[480px] rounded bg-surface-container px-4 py-3.5">
              <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-3 text-[12.5px]">
                {meters.map(([label, m]) => {
                  const used = percent(m);
                  const at = resetsAt(m);
                  return (
                    <Fragment key={label}>
                      <span className="text-ink">{label}</span>
                      <span className="block h-1.5 min-w-16 rounded-full bg-border-gray">
                        <span className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-[cubic-bezier(.2,.7,.2,1)]" style={{ width: `${used ?? 0}%` }} />
                      </span>
                      <span className="text-right tabular-nums text-ink">{used == null ? "No limit" : `${used}%`}</span>
                      <span className="text-faint">{at ? `resets ${at}` : ""}</span>
                    </Fragment>
                  );
                })}
              </div>
            </div>
          )}
          {c.available && c.on && (
            <div className="mt-4 flex items-center gap-3">
              <Switch
                label="Switch to my Claude Code when it runs out"
                checked={c.fallback}
                onChange={(on) => {
                  setC({ ...c, fallback: on });
                  void setFallback(on);
                }}
              />
              <span className="text-[13px] text-ink">Switch to my Claude Code when it runs out</span>
            </div>
          )}
          {c.reason && <p className="mt-2 text-[12px] text-clay-ink">{c.reason}</p>}
          <div className="mt-4 flex items-baseline gap-2 text-[12.5px] text-muted-slate">
            <span>
              Signed in as <span className="text-ink">@{c.login}</span>
            </span>
            <span aria-hidden>·</span>
            <button type="button" onClick={() => void signOut()} className="cursor-pointer text-accent hover:underline">
              Sign out
            </button>
            <a
              href="https://blpr.dev/promotion"
              onClick={(e) => (e.preventDefault(), external("https://blpr.dev/promotion"))}
              className="ml-auto text-accent hover:underline"
            >
              Promotion terms
            </a>
          </div>
        </>
      ) : signin && "code" in signin ? (
        <GitHubCode code={signin.code} url={signin.url} onCancel={() => setSignin(null)} />
      ) : (
        <>
          <Button onClick={() => void begin()}>Sign in with GitHub</Button>
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
    <Segmented
      label="Usage reports"
      value={on}
      options={[
        { value: true, label: "Send" },
        { value: false, label: "Don't send" },
      ]}
      onChange={choose}
    />
  );
}

/** The release running and any staged to replace it (lib/server/update.ts); the About window shows only macOS's. */
function Version() {
  const [s, setS] = useState<{ version: string | null; ready: string | null } | null>(null);
  useEffect(() => {
    fetch("/api/update")
      .then((r) => r.json())
      .then(setS, () => setS(null));
  }, []);
  if (!s) return null;
  return (
    <p className="text-[13px] text-ink">
      {s.version ?? "Built from source"}
      {s.ready ? <span className="text-muted-slate"> · {s.ready} downloaded, used when Blueprint restarts</span> : null}
    </p>
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
  if (!kept) return <span className="text-[12.5px] text-faint">{failed ?? "Looking…"}</span>;
  const rows = [
    ...kept.global.map((site) => ({ site, root: null as string | null, where: "All projects" })),
    ...Object.entries(kept.projects).flatMap(([root, sites]) =>
      sites.map((site) => ({ site, root, where: root.split("/").filter(Boolean).pop() ?? root })),
    ),
  ];
  if (!rows.length) return <span className="text-[12.5px] text-muted-slate">No sites yet. When you sign in to a site in a Preview tab, it is kept here so you stay signed in.</span>;
  return (
    <ul className="flex flex-col gap-1 text-[12.5px]">
      {rows.map((r) => (
        <li key={`${r.root ?? ""}:${r.site}`} className="flex items-center gap-3 rounded-md bg-surface-container px-3 py-2">
          <span className="truncate text-ink">{r.site}</span>
          <span className="truncate text-faint" title={r.root ?? undefined}>
            {r.where}
          </span>
          <button
            type="button"
            onClick={() => invoke("signin_forget", { root: r.root, site: r.site }).then(read, (e) => setFailed(String(e)))}
            className="ml-auto shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-muted-slate transition-colors hover:bg-card hover:text-ink"
          >
            Forget
          </button>
        </li>
      ))}
      {failed ? <li className="text-clay-ink">{failed}</li> : null}
    </ul>
  );
}
