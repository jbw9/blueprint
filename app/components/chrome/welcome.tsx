"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Kbd, keys } from "@/components/ui/button";
import { useMac } from "@/lib/client/platform";
import { newProject, openFolder, openProjects } from "@/components/projects/projects";
import { cn } from "@/lib/client/utils";
import { readSettings, saveSettings, useSettings, type Theme } from "@/lib/client/settings";
import { pollSignIn, readCredit, startSignIn } from "@/lib/client/credit";
import type { BlueprintEntry } from "@/lib/server/blueprints";
import { external, GitHubCode } from "@/components/chrome/settings";

/**
 * The blank page: what the window shows with no project open — none asked
 * for, the one asked for is gone, or the open one was just deleted. Laid out
 * as VS Code's welcome is: Start on one side, Recent on the other, which with
 * no projects yet is just Start.
 */
export function NoProject({ blueprints }: { blueprints: BlueprintEntry[] }) {
  const router = useRouter();
  const { onboarded } = useSettings();
  // The saved settings are only known in the browser: until then show
  // nothing, so a returning reader never sees the tour flash by.
  const ready = useSyncExternalStore(noop, () => true, () => false);
  if (!ready) return <main className="flex-1 bg-paper" />;
  if (!onboarded && !blueprints.length) return <Tour />;
  return (
    <main className="flex min-h-0 flex-1 justify-center overflow-y-auto bg-paper px-6 py-16">
      <div className="w-full max-w-[640px]">
        <h1 className="font-display text-[32px] font-normal leading-[1.05] tracking-[-0.016em] text-ink">Make a blueprint of a repository</h1>
        <p className="mt-1 text-[14px] text-on-surface-variant">Claude Code reads it and writes a blueprint you can open a level at a time, down to the line.</p>
        <div className="mt-8 grid gap-10 sm:grid-cols-2">
          <section>
            <h2 className="mb-2 text-[13px] font-semibold text-ink">Start</h2>
            <ul className="flex flex-col gap-1.5 text-[13px]">
              <li>
                <button type="button" onClick={() => void openFolder()} className={LINK}>
                  Open Folder…
                </button>
              </li>
              <li>
                <button type="button" onClick={newProject} className={LINK}>
                  New Project…
                </button>
              </li>
              {blueprints.length ? (
                <li>
                  <button type="button" onClick={() => openProjects()} className={LINK}>
                    Manage Projects…
                  </button>
                </li>
              ) : null}
            </ul>
          </section>
          {blueprints.length ? (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold text-ink">Recent</h2>
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {blueprints.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => router.push(`/?blueprint=${encodeURIComponent(m.id)}`)} className={cn(LINK, "max-w-full truncate font-mono")}>
                      {m.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <p className="mt-10 flex items-center gap-1.5 text-[12px] text-faint">
          Once its blueprint is made, <GoTo /> goes to any level.
        </p>
      </div>
    </main>
  );
}

const noop = () => () => {};
const finish = () => saveSettings({ ...readSettings(), onboarded: true });

/**
 * The first run: the theme, then the way in. Two steps, either skippable.
 */
function Tour() {
  const [step, setStep] = useState(0);
  const steps = [
    { title: "Pick a look", body: "It changes as you choose. Settings can change it later.", view: <Themes /> },
    { title: "Make your first blueprint", body: "Open a folder on this machine, or clone one from GitHub. Claude Code writes the blueprint. When it finishes, Blueprint sends us how long it took and what it cost, never your code; Settings turns that off.", view: <Begin /> },
  ];
  const last = step === steps.length - 1;
  return (
    <main className="flex min-h-0 flex-1 justify-center overflow-y-auto bg-paper px-6 py-16">
      <div className="w-full max-w-[640px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
          {step + 1} / {steps.length}
        </p>
        <div key={step} className="animate-[tour-in_220ms_ease-out]">
          <h1 className="mt-2 font-display text-[32px] font-normal leading-[1.05] tracking-[-0.016em] text-ink">{steps[step].title}</h1>
          <p className="mt-1 text-[14px] text-on-surface-variant">{steps[step].body}</p>
          <div className="mt-8">{steps[step].view}</div>
        </div>
        <div className="mt-10 flex items-center gap-2">
          <div className="mr-auto flex gap-1.5" aria-hidden>
            {steps.map((_, i) => (
              <span key={i} className={cn("h-1.5 w-6 transition-colors", i <= step ? "bg-accent" : "bg-border-gray")} />
            ))}
          </div>
          <Button variant="ghost" onClick={finish}>
            {last ? "Not now" : "Skip"}
          </Button>
          {step > 0 ? <Button onClick={() => setStep(step - 1)}>Back</Button> : null}
          {last ? null : (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              Next
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}

/* ── step 1: the theme ────────────────────────────────────────── */

/** Each theme's own colours, so a card shows its theme whatever the page is in. */
const LOOKS: { value: Theme; label: string; note: string; bar: string; paper: string; ink: string; line: string; box: string; tint: string }[] = [
  { value: "classic", label: "Classic", note: "Cobalt ink on white", bar: "#0a0a0b", paper: "#ffffff", ink: "#2438c8", line: "#a9b3ee", box: "#f6f8fe", tint: "#e3e8fc" },
  { value: "light", label: "Light", note: "Soft grey, slate ink", bar: "#eceef1", paper: "#f5f6f8", ink: "#1f2328", line: "#d8dce2", box: "#ffffff", tint: "#e6edf5" },
  { value: "dark", label: "Dark", note: "Easy at night", bar: "#000000", paper: "#0f0f11", ink: "#fafafa", line: "#3a3a40", box: "#18181b", tint: "#222226" },
];

function Themes() {
  const { theme } = useSettings();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3">
      {LOOKS.map((l) => {
        const on = theme === l.value;
        return (
          <button
            key={l.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => saveSettings({ ...readSettings(), theme: l.value })}
            className={cn(
              "cursor-pointer border p-2 text-left transition-[border-color,box-shadow] duration-100",
              on ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "border-border-gray hover:border-border-strong",
            )}
          >
            <Mini look={l} />
            <span className="mt-2 flex items-center justify-between px-1">
              <span className="text-[13px] font-semibold text-ink">{l.label}</span>
              {on ? <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-accent">On</span> : null}
            </span>
            <span className="block px-1 text-[12px] text-muted-slate">{l.note}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The app in miniature: a title bar, a heading, three boxes, a line of code. */
function Mini({ look: l }: { look: (typeof LOOKS)[number] }) {
  return (
    <span className="block aspect-[4/3] overflow-hidden border" style={{ background: l.paper, borderColor: l.line }} aria-hidden>
      <span className="flex h-[12%] items-center gap-[3px] px-1.5" style={{ background: l.bar }}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-[5px] rounded-full" style={{ background: l.line }} />
        ))}
      </span>
      <span className="block px-2.5 pt-2.5">
        <span className="block font-display text-[13px] leading-none" style={{ color: l.ink }}>
          my-app
        </span>
        <span className="mt-1.5 block h-[3px] w-1/2" style={{ background: l.line }} />
        <span className="mt-2.5 grid grid-cols-3 gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="block h-7 border p-1" style={{ background: l.box, borderColor: l.line }}>
              <span className="block h-[3px] w-3/4" style={{ background: l.ink }} />
            </span>
          ))}
        </span>
        <span className="mt-2 block h-5 p-1" style={{ background: l.tint }}>
          <span className="block h-[3px] w-2/3" style={{ background: l.ink, opacity: 0.6 }} />
        </span>
      </span>
    </span>
  );
}

/* ── step 2: the way in ───────────────────────────────────────── */

/** The palette's Go to key (components/chrome/palette.tsx), as this platform writes it. */
function GoTo() {
  return <Kbd>{keys(useMac(), "P")}</Kbd>;
}

function Begin() {
  const go = (f: () => unknown) => () => {
    finish();
    void f();
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <button type="button" onClick={go(openFolder)} className={CARD}>
        <span className="block text-[14px] font-semibold text-ink">Open Folder…</span>
        <span className="mt-1 block text-[12.5px] text-muted-slate">A repository already on this machine.</span>
      </button>
      <button type="button" onClick={go(newProject)} className={CARD}>
        <span className="block text-[14px] font-semibold text-ink">New Project…</span>
        <span className="mt-1 block text-[12.5px] text-muted-slate">Clone one from GitHub, then make its blueprint.</span>
      </button>
      <p className="flex items-center gap-1.5 text-[12px] text-faint sm:col-span-2">
        Once its blueprint is made, <GoTo /> goes to any level.
      </p>
      <Promo />
    </div>
  );
}

const TERMS = "https://blpr.dev/promotion";

/** Blueprint's free Claude Code promotion, while it is on and this machine isn't signed in to it yet. */
function Promo() {
  const [shown, setShown] = useState(false);
  // GitHub's code while the reader enters it, the account once they have, or why signing in stopped.
  const [signin, setSignin] = useState<{ code: string; url: string; interval: number } | { login: string } | { reason: string } | null>(null);
  useEffect(() => void readCredit().then((c) => setShown(!!c?.promo && !c.login)), []);
  useEffect(() => {
    if (!signin || !("code" in signin)) return;
    let stop = false;
    let t: ReturnType<typeof setTimeout>;
    const poll = (wait: number) => {
      t = setTimeout(async () => {
        const p = await pollSignIn().catch(() => ({ wait }));
        if (stop) return;
        if ("wait" in p) poll(p.wait);
        else setSignin(p);
      }, wait * 1000);
    };
    poll(signin.interval);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [signin]);
  if (!shown) return null;

  const begin = async () => {
    const r = await startSignIn().catch(() => ({ reason: "Blueprint could not start the sign-in." }));
    setSignin(r);
    if ("code" in r) external(r.url);
  };
  return (
    <div className="border border-accent bg-accent-surface p-4 sm:col-span-2">
      <span className="block text-[14px] font-semibold text-ink">Claude Code is free for a limited time</span>
      <span className="mt-1 block text-[12.5px] text-muted-slate">
        Sign in with GitHub and Blueprint pays for the Claude behind it. Making blueprints is unlimited, within fair use. Claude tabs get about half of a Claude Pro plan,
        in a 5-hour session and a weekly limit like Claude Code&rsquo;s own. When that runs out, they switch to your own Claude Code by themselves.
      </span>
      {signin && "code" in signin ? (
        <div className="mt-4">
          <GitHubCode code={signin.code} url={signin.url} onCancel={() => setSignin(null)} />
        </div>
      ) : signin && "login" in signin ? (
        <span className="mt-3 block text-[12.5px] text-ink">Signed in as @{signin.login}. Claude Code now runs on Blueprint credit.</span>
      ) : (
        <span className="mt-3 flex items-center gap-3 text-[12.5px]">
          <Button onClick={() => void begin()}>Sign in with GitHub</Button>
          <a href={TERMS} onClick={(e) => (e.preventDefault(), external(TERMS))} className={LINK}>
            Terms
          </a>
        </span>
      )}
      {signin && "reason" in signin && <span className="mt-1.5 block text-[12px] text-clay-ink">{signin.reason}</span>}
    </div>
  );
}

const CARD =
  "cursor-pointer border border-border-strong bg-card p-4 text-left transition-[border-color,transform] duration-100 hover:-translate-y-px hover:border-accent focus-visible:outline-2 focus-visible:outline-accent";

const LINK = "cursor-pointer text-left text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent";
