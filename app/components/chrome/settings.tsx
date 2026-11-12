"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { DIALOG, Field, INPUT, Overlay, Segmented } from "@/components/ui/dialog";
import { Button, dictateKeys, keys } from "@/components/ui/button";
import { AgentIcon, CLAUDE, useInstalled } from "@/components/agent/agents";
import { PanelClose, PanelHead } from "@/components/ui/panel";
import { followTheme, onOpenSettings, readSettings, saveSettings, useSettings, type Ground, type Settings, type Theme } from "@/lib/client/settings";
import { useDesktop, useMac } from "@/lib/client/platform";
import { onCreditChanged, percent, pollSignIn, readCredit, resetsAt, setCredit, setFallback, signOut, startSignIn, type Credit } from "@/lib/client/credit";

/**
 * Settings, as a dialog over the blueprint, in groups: how it looks, Claude Code,
 * dictation, the Preview, and what is sent to Blueprint. Every change is saved as
 * it is made, so there is nothing to confirm and nothing to undo. Outside the
 * desktop app (a page framed in a Preview) only the look applies, so only it shows.
 */

const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
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

/** A group of settings under its name; only the one picked in the list shows. */
function Group({ title, shown, children }: { title: Section; shown: Section; children: React.ReactNode }) {
  if (title !== shown) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-6">
      <h3 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">{title}</h3>
      {children}
    </section>
  );
}

const SECTIONS = ["Appearance", "Claude Code", "Dictation", "Preview", "Privacy", "About"] as const;
type Section = (typeof SECTIONS)[number];

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("Appearance");
  // What is on screen is what is saved: there is no draft to keep in step.
  const draft = useSettings();
  // undefined while looking.
  const [found, setFound] = useState<Found | undefined>(undefined);
  const agents = [CLAUDE, ...useInstalled()];
  const mac = useMac();
  const desktop = useDesktop();
  const hold = dictateKeys(mac);

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
        setSection("Appearance");
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
      <form
        role="dialog"
        aria-label="Settings"
        onSubmit={(e) => {
          e.preventDefault();
          close();
        }}
        className={`${DIALOG} ${desktop ? "h-[560px] max-w-[780px]" : "max-w-[520px]"}`}
      >
        <PanelHead title="Settings" right={<PanelClose type="submit" />} />
        <div className="flex min-h-0 flex-1">
          {desktop ? (
            <nav aria-label="Settings sections" className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border-gray bg-surface-container-low p-3">
              {SECTIONS.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-current={name === section}
                  onClick={() => setSection(name)}
                  className={`cursor-pointer px-3 py-2.5 text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                    name === section ? "bg-surface-container font-semibold text-ink shadow-[inset_3px_0_0_var(--color-accent)]" : "text-muted-slate hover:bg-surface-container hover:text-ink"
                  }`}
                >
                  {name}
                </button>
              ))}
            </nav>
          ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-7 py-6">
          <Group title="Appearance" shown={section}>
            <Field group label="Theme" hint="Dark or Light.">
              <Segmented label="Theme" value={draft.theme} options={THEMES} onChange={(theme) => set({ theme })} />
            </Field>
            <Field group label="Background" hint="What the blueprint is drawn on.">
              <Segmented label="Background" value={draft.ground} options={GROUNDS} onChange={(ground) => set({ ground })} />
            </Field>
          </Group>
          {desktop ? (
            <>
              <Group title="Claude Code" shown={section}>
                <BlueprintCredit />
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
                  label="Skills and web research"
                  hint="Claude loads skills and searches or reads the web without asking each time. Plan mode always does, and still never edits files."
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
                    hint={`What a tab opens into when the app opens one for you: ${keys(mac, "`")}, ${keys(mac, "T", { shift: true })}, the title bar, or the first in the + menu. Blueprint context goes to Claude either way.`}
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
                <p className="text-[12px] text-faint">These apply to Claude tabs opened from now on.</p>
              </Group>
              <Group title="Dictation" shown={section}>
                <Field
                  group
                  label="Claude Code dictation"
                  hint={`Hold ${hold}, or Space in a Claude tab, and speak into Claude's prompt. Transcribed by Anthropic at no cost to your usage; needs a claude.ai sign-in, not Bedrock or an API key.`}
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
                  label="On-device dictation"
                  hint={`Hold ${hold} in a field in the app, or for Claude's prompt where Claude Code dictation isn't available. Runs on this machine, for any sign-in; nothing is sent anywhere.`}
                >
                  <OnDevice />
                </Field>
                <Field group label="Media while dictating" hint={`Pauses Music and Spotify, and mutes everything else, while you hold ${hold}; all of it comes back when you let go.`}>
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
              <Group title="Preview" shown={section}>
                <Field group label="Dev server" hint="Start a project's dev server when it opens, and show the running app in a Preview tab.">
                  <Segmented
                    label="Dev server"
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
                  label="Saved sign-ins"
                  hint="Sites you signed in to in the Preview when Claude asked. Blueprint keeps their sign-in cookies, never your password. Forget signs you out."
                >
                  <SignIns />
                </Field>
              </Group>
              <Group title="Privacy" shown={section}>
                <Field
                  group
                  label="Usage reports"
                  hint="Once a day when it opens, Blueprint tells the Blueprint team its version and your system. When a blueprint finishes, it sends how long it took, what it cost, the repository's name and the end of its log, and the GitHub account you're signed in to Blueprint credit with, so the mapping keeps getting better. Never your code."
                >
                  <RunReports />
                </Field>
              </Group>
              <Group title="About" shown={section}>
                <Field group label="Version" hint="Blueprint updates itself; a newer version is used once Blueprint restarts.">
                  <Version />
                </Field>
              </Group>
            </>
          ) : null}
        </div>
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
    if ("code" in r) external(r.url);
  };
  const meters = c.available && c.meters ? ([["Session", c.meters.session], ["Week", c.meters.week], ["Blueprints", c.meters.maps]] as const) : [];
  return (
    <Field
      group
      label="Blueprint credit"
      hint={`${c.promo ? "Claude Code included, free for a limited time. " : ""}Claude tabs and new blueprints run on Blueprint's Claude instead of your own Claude Code, only inside Blueprint. Making blueprints is unlimited, within fair use. Claude tabs get about half of a Claude Pro plan, in a 5-hour Session and a Week.`}
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
            <div className="mt-3 flex flex-col gap-2.5 font-mono text-[11.5px]">
              {meters.map(([label, m]) => {
                const used = percent(m);
                const at = resetsAt(m);
                return (
                  <div key={label} className="flex flex-col gap-1">
                    <div className="flex items-baseline gap-3">
                      <span className="text-ink">{label}</span>
                      <span className="ml-auto text-ink">{used == null ? "no limit" : `${used}% used`}</span>
                      {at && <span className="text-faint">resets {at}</span>}
                    </div>
                    <span className="h-1 w-full bg-border-gray">
                      <span className="block h-full bg-accent" style={{ width: `${used ?? 0}%` }} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {c.available && (
            <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[12px] text-muted-slate">
              <input
                type="checkbox"
                checked={c.fallback}
                onChange={(e) => {
                  setC({ ...c, fallback: e.target.checked });
                  void setFallback(e.target.checked);
                }}
                className="mt-0.5 accent-accent"
              />
              <span>
                <span className="text-ink">Switch to my Claude Code when it runs out.</span> A Claude tab on Blueprint credit picks its conversation up on your own Claude Code, signed in as it is, and carries on. New tabs are on Blueprint credit again once it resets.
              </span>
            </label>
          )}
          {c.reason && <p className="mt-1.5 text-[12px] text-clay-ink">{c.reason}</p>}
          <p className="mt-2 font-mono text-[11.5px] text-faint">
            <a href="https://blpr.dev/promotion" onClick={(e) => (e.preventDefault(), external("https://blpr.dev/promotion"))} className="text-accent hover:underline">
              Promotion terms
            </a>{" "}
            · Signed in as @{c.login} ·{" "}
            <button type="button" onClick={() => void signOut()} className="cursor-pointer text-accent hover:underline">
              Sign out
            </button>
          </p>
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
