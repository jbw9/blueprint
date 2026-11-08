"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import f from "./landing-features.module.css";

/**
 * The desktop app's other tools, drawn: the workspace, plans, diffs and the
 * running app need the desktop app, so the live frame (a static export of a
 * blueprint) can't show them. Each is drawn from the real components' markup in
 * the app's Classic theme, with this repo's and the Wikipedia demo's own names,
 * and plays once when its tab opens.
 */
export type Drawing = "claude" | "plan" | "review" | "run";

/**
 * The size the drawings are laid out for. They scale to the stage, never
 * smaller than this in either direction, so a short laptop screen and a phone
 * see the same composition, only smaller.
 */
const WIDE = 1100;
const TALL = 680;

/** When a piece arrives (`--t`) and, for one that passes, leaves (`--u`): seconds after the tab opens. */
const at = (t: number, u?: number) => ({ "--t": `${t}s`, ...(u === undefined ? {} : { "--u": `${u}s` }) }) as CSSProperties;

export function Drawn({ drawing }: { drawing: Drawing }) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ k: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => {
      if (!el.clientWidth || !el.clientHeight) return;
      const k = Math.min(1.2, el.clientWidth / WIDE, el.clientHeight / TALL);
      setFit({ k, w: el.clientWidth / k, h: el.clientHeight / k });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const Scene = SCENES[drawing];
  return (
    <div ref={box} aria-hidden className={f.fit}>
      {fit ? (
        <div className={f.app} style={{ width: fit.w, height: fit.h, transform: `scale(${fit.k})` }}>
          <Scene />
        </div>
      ) : null}
    </div>
  );
}

/* ── Claude Code beside the blueprint ─────────────────────────── */

const QUESTION = "how does a first blueprint get made?";

function ClaudeScene() {
  return (
    <Window
      projects={<Project on>blueprint</Project>}
      tabs={
        <Tab on icon={<BlueprintIcon />}>
          <span className={f.swap}>
            <span className={f.out} style={at(0, 5.6)}>
              Blueprint
            </span>
            <span className={f.in} style={at(5.6)}>
              Partitioning And Authoring
            </span>
          </span>
        </Tab>
      }
    >
      <div className={`${f.page} ${f.out}`} style={{ "--ws": "44%", ...at(0, 5.6) } as CSSProperties}>
        <Head title="blueprint" sub="Visual codebase explorer with AI-generated blueprints" meta="239 files · commit d542300" />
        <p className={f.cap}>
          How the parts connect<span>colours match the parts below</span>
        </p>
        <Diagram boxes={TOP} links={TOP_LINKS} w={232} gx={64} gy={52}>
          <svg className={f.mouse} style={{ left: "74%", top: "47%" }} viewBox="0 0 16 16">
            <path d="M2.5 1.5v12l3.2-3 2.2 4.7 2.1-1-2.2-4.6h4.4z" />
          </svg>
          <div className={`${f.menu} ${f.blip}`} style={{ left: "50%", top: "56%", ...at(1.35, 2.45) }}>
            <p>Generating Blueprints</p>
            <span>Open in new tab</span>
            <span className={f.hot} style={at(2)}>
              Add to Claude
            </span>
          </div>
        </Diagram>
      </div>
      <div className={`${f.page} ${f.in}`} style={{ "--ws": "44%", ...at(5.7) } as CSSProperties}>
        <Head
          back={["Generating Blueprints"]}
          title="Partitioning And Authoring"
          eyebrow="Inside Generating Blueprints"
          sub="Groups files into roots and writes sections."
          action={
            <span className={`${f.btn} ${f.in}`} style={at(7.6)}>
              Keep the answer
            </span>
          }
        />
        <ol className={f.flow}>
          {AUTHOR_STEPS.map(([title, body, file], i) => (
            <li key={title} className={f.in} style={at(5.9 + i * 0.12)}>
              <b>{title}</b>
              <span>{body}</span>
              <code>{file}</code>
            </li>
          ))}
        </ol>
      </div>
      <Workspace
        width="44%"
        tabs={
          <>
            <WsTab on icon={<ClaudeIcon />} dot={[4.6, 7.4]}>
              claude 1
            </WsTab>
            <WsTab icon={<TerminalIcon />}>zsh 2</WsTab>
          </>
        }
      >
        <div className={f.term}>
          <Hello />
          <p className={`${f.you} ${f.in}`} style={at(4.6)}>
            &gt; <span className={f.pick}>[Generating Blueprints]</span> {QUESTION}
          </p>
          <div className={`${f.msg} ${f.in}`} style={at(5)}>
            <span className={f.ok}>⏺</span>
            <span>
              <b>blueprint - blueprint_section</b> (MCP)(id: &quot;Generating Blueprints&quot;)
              <br />
              <span className={f.res}>⎿&nbsp;&nbsp;6 parts: Credit Metering, Pipeline Orchestration, Repository Analysis, Partitioning And Authoring, …</span>
            </span>
          </div>
          <div className={`${f.msg} ${f.in}`} style={at(5.4)}>
            <span className={f.ok}>⏺</span>
            <span>
              <b>Bash</b>(blueprint-show section &quot;Partitioning And Authoring&quot;)
              <br />
              <span className={f.res}>⎿&nbsp;&nbsp;Showing Partitioning And Authoring</span>
            </span>
          </div>
          <div className={`${f.msg} ${f.in}`} style={at(6.3)}>
            <span>⏺</span>
            <span>
              In four passes. It reads and summarises every file, then <b>cut.ts</b> splits the repo into four to ten roots,
              and an author agent per root writes its sections (<b>author.ts</b>).
            </span>
          </div>
          <div className={`${f.msg} ${f.in}`} style={at(7)}>
            <span />
            <span>Each sentence is checked against the lines it cites before it&rsquo;s kept. Partitioning And Authoring is open beside you.</span>
          </div>
          <span className={f.grow} />
          <Prompt>
            <span className={`${f.pick} ${f.blip}`} style={at(2.5, 4.6)}>
              [Generating Blueprints]{" "}
            </span>
            <span className={f.typed} style={{ "--n": QUESTION.length, ...at(2.75, 4.6) } as CSSProperties}>
              {QUESTION}
            </span>
          </Prompt>
        </div>
      </Workspace>
    </Window>
  );
}

/** The repo's top level, as its blueprint draws it. */
const TOP: Box[] = [
  { id: "app", label: "Viewing a Blueprint", col: 0, row: 0, sec: 1 },
  { id: "ui", label: "Building The App", col: 1, row: 0, sec: 2 },
  { id: "lib", label: "Shared Libraries", col: 0, row: 1, sec: 3 },
  { id: "gen", label: "Generating Blueprints", col: 1, row: 1, sec: 4 },
  { id: "land", label: "Landing Site", col: 0, row: 2, sec: 5 },
  { id: "tauri", label: "Running the Desktop App", col: 1, row: 2, sec: 6 },
];
const TOP_LINKS: Link[] = [
  { from: "app", to: "ui", label: "renders" },
  { from: "app", to: "lib", label: "posts to API routes" },
  { from: "lib", to: "gen", label: "runs git" },
  { from: "gen", to: "tauri", label: "draws diagrams" },
  { from: "ui", to: "gen", label: "invokes commands" },
];

const AUTHOR_STEPS: [string, string, string][] = [
  ["Root Partitioning", "Splits the repository into user-facing roots and exclusions.", "app/scripts/generate/cut.ts"],
  ["Agent Authoring", "An agent per root writes its sections in a loop, checking each against the code.", "app/scripts/generate/author.ts"],
  ["Deep Sections", "Builds the detailed sections from the source code.", "app/scripts/generate/deep.ts"],
  ["Overview Generator", "Builds the top-level repository overview.", "app/scripts/generate/overview.ts"],
];

/* ── a plan, before it is built ─────────────────────────── */

/** The plan as written in plan mode, open in the main view with Claude's window put away. */
function PlanScene() {
  return (
    <Window
      projects={<Project on>blueprint</Project>}
      tabs={
        <>
          <Tab icon={<BlueprintIcon />}>Blueprint</Tab>
          <Tab on icon={<PlanIcon />}>
            Saved sign-ins for the Preview
          </Tab>
        </>
      }
    >
      <div className={f.doc}>
        <article className={f.scroll} style={at(3.2)}>
          <header className={f.in} style={at(0.15)}>
            <p className={f.planMeta}>
              <Eyebrow>Plan</Eyebrow>
              <span>
                6 steps{" "}
                · 7 files <b data-v="changed">~6</b> <b data-v="added">+1</b> · 2 min read
              </span>
            </p>
            <h3 className={f.planTitle}>Saved sign-ins for the Preview</h3>
            <p className={f.lede}>
              You sign in to a site once in the Preview, choose &ldquo;all projects&rdquo; or &ldquo;only this project&rdquo;,
              and from then on Claude opens it already signed in. Blueprint keeps the site&rsquo;s cookies the way a browser
              does and never stores your password.
            </p>
          </header>
          <section className={f.in} style={at(0.4)}>
            <Eyebrow>How it works</Eyebrow>
            <p className={f.figCap}>
              Where a sign-in is kept<span>green is new · amber changes</span>
            </p>
            <Diagram boxes={PLAN_BOXES} links={PLAN_LINKS} w={170} gx={44} gy={44} />
          </section>
          <section className={f.in} style={at(0.55)}>
            <Eyebrow>What you&rsquo;ll see</Eyebrow>
            <PlanScreen />
          </section>
          <section className={f.in} style={at(0.7)}>
            <Eyebrow>Steps</Eyebrow>
            <ol className={f.steps}>
              {PLAN_STEPS.map((s, i) => (
                <li key={i} data-state={i === 0 ? "done" : i === 1 ? "doing" : undefined} style={at(i === 0 ? 9.6 : 9.9)}>
                  <i>{i + 1}</i>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className={f.in} style={at(0.8)}>
            <Eyebrow>Files</Eyebrow>
            <ul className={f.files}>
              {PLAN_FILES.map(([v, path, why]) => (
                <li key={path}>
                  <b data-v={v}>{v === "added" ? "+" : "~"}</b>
                  <code>{path}</code>
                  <span>{why}</span>
                </li>
              ))}
            </ul>
          </section>
        </article>
        <footer className={`${f.ask} ${f.in}`} style={at(1.2)}>
          <div className={f.out} style={at(0, 9)}>
            <div>
              <span className={f.askQ}>
                <i />
                Build this plan?
              </span>
              <span className={f.btn}>Yes, manually approve edits</span>
              <span className={`${f.btn} ${f.primary} ${f.press}`} style={at(8.6)}>
                Yes, and use auto mode
              </span>
            </div>
            <div>
              <span className={f.field}>No, keep planning…</span>
              <span className={f.btn} data-off>
                Send
              </span>
            </div>
          </div>
          <div className={f.in} style={at(9)}>
            <div>
              <span className={f.askQ} data-ok>
                <i />
                Accepted. Claude is building it.
              </span>
              <span className={f.btn}>Show Claude</span>
            </div>
          </div>
        </footer>
      </div>
      {/* The window put away: its tabs' dots wait in the corner. */}
      <div className={`${f.dots} ${f.in}`} style={at(1.2)}>
        <ClaudeIcon />
        <span className={f.swap}>
          <Dot status="waiting" className={f.out} style={at(0, 9)} />
          <Dot status="working" className={f.in} style={at(9)} />
        </span>
      </div>
    </Window>
  );
}

const PLAN_BOXES: Box[] = [
  { id: "claude", label: "Claude", sub: "navigate, sign_in", col: 0, row: 0 },
  { id: "tools", label: "Preview tools", sub: "src-tauri/src/mcp.rs", col: 0, row: 1, v: "changed" },
  { id: "bar", label: "Sign-in bar", sub: "preview/sign-in-bar.tsx", col: 1, row: 0, v: "added" },
  { id: "rules", label: "Site rules", sub: "sign-ins.json, hosts only", col: 1, row: 1, v: "added" },
  { id: "view", label: "Web view", sub: "src-tauri/src/browser.rs", col: 1, row: 2, v: "changed" },
  { id: "shared", label: "Shared store", sub: "all projects", col: 2, row: 1 },
  { id: "own", label: "Project store", sub: "one per project", col: 2, row: 2, v: "added" },
];
const PLAN_LINKS: Link[] = [
  { from: "claude", to: "tools", label: "sign_in" },
  { from: "claude", to: "bar", label: "asks you", v: "added" },
  { from: "bar", to: "rules", label: "your choice", v: "added" },
  { from: "rules", to: "view", label: "picks store", v: "added" },
  { from: "rules", to: "shared", label: "default" },
  { from: "view", to: "own", label: "project-only", v: "added" },
];

/** The plan's ```screen, as components/blueprint/blocks.tsx numbers a screen's notes when its lines can't be drawn. */
const PLAN_SCREEN: { type: "heading" | "choice" | "button" | "image"; label: string; note: string }[] = [
  { type: "heading", label: "Claude needs you to sign in to instagram.com", note: "a new bar over the page; Claude can't type into the page while it shows" },
  { type: "choice", label: "Keep for: All projects · Only this project", note: "new; social sites default to all projects, the rest to this one" },
  { type: "button", label: "I'm signed in", note: "new; Claude carries on" },
  { type: "image", label: "the site's own login page", note: "you type your password here yourself" },
];

function PlanScreen() {
  return (
    <div className={f.planScreen}>
      <div className={f.browser}>
        <div className={f.browserBar}>
          <span>
            <i />
            <i />
            <i />
          </span>
          <p>instagram.com/accounts/login</p>
        </div>
        <div className={f.browserBody}>
          {PLAN_SCREEN.map((it, i) => (
            <div key={it.label} className={f.thing} data-type={it.type}>
              {it.label}
              <em>{i + 1}</em>
            </div>
          ))}
        </div>
      </div>
      <ol className={f.notes}>
        {PLAN_SCREEN.map((it, i) => (
          <li key={it.label}>
            <em>{i + 1}</em>
            <span>
              <b>{it.label}</b> — {it.note}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const PLAN_STEPS = [
  "Give every project its own WebKit cookie store, next to the shared one.",
  "Keep a short list of which sites use which store. It holds site names only, never secrets.",
  "When the web view opens a site, use the store its rule names, reopening the view if the store changes.",
  "Add a sign_in tool for Claude: it shows the bar, you choose where to keep the sign-in, and you sign in yourself.",
  "While the bar is up, Claude can't type into the page, and it never reads or fills a password field.",
  "List saved sign-ins in Settings with a Forget button each. Removing a project deletes its store.",
];

type Change = "added" | "changed";

const PLAN_FILES: [Change, string, string][] = [
  ["changed", "app/src-tauri/src/browser.rs", "open the web view with a per-project store"],
  ["changed", "app/src-tauri/src/mcp.rs", "add the sign_in tool"],
  ["added", "app/components/preview/sign-in-bar.tsx", "the bar, and where to keep it"],
  ["changed", "app/components/preview/preview.tsx", "show the bar, pick the store"],
  ["changed", "app/src-tauri/src/agent.js", "refuse password fields"],
  ["changed", "app/components/chrome/settings.tsx", "saved sign-ins, with Forget"],
  ["changed", "app/src-tauri/Cargo.toml", "WebKit data-store features"],
];

/* ── a change, on the blueprint ───────────────────────────────── */

function ReviewScene() {
  return (
    <Window projects={<Project on>blueprint</Project>} git tabs={<Tab on icon={<BlueprintIcon />}>Building The App</Tab>}>
      <div className={f.diffBar}>
        <span className={f.showing}>
          <i />
          <b>Showing changes</b>
          <span>
            <code>6398cf4</code> clearer blueprint menu
          </span>
        </span>
        <span className={f.legend}>
          <span data-v="added">+ new</span>
          <span data-v="changed">~ changed</span>
          <span data-v="removed">− gone</span>
        </span>
        <span className={f.stepper}>
          <span>‹ Prev</span>
          <span className={f.count}>1 of 1 changed</span>
          <span>Next ›</span>
          <i />
          <span>History</span>
          <span>Exit</span>
        </span>
      </div>
      <div className={f.page}>
        <Head back={["Blueprint"]} title="Building The App" eyebrow="Inside blueprint" sub="React components for the canvas, menus and dialogs." />
        <div className={`${f.narrow} ${f.in}`} style={at(0.1)}>
          <Diagram boxes={APP_BOXES} links={APP_LINKS} w={196} gx={56} gy={46} recede />
        </div>
        <div className={`${f.changes} ${f.in}`} style={at(0.35)}>
          <p>1 part of this picture changed — open it to read its lines</p>
          <div className={f.change}>
            <span className={f.caret}>▾</span>
            <b className={f.mark}>~</b>
            <b>StatusBar</b>
            <span className={f.word}>changed</span>
            <span className={f.faint}>1 file</span>
            <span className={f.stat}>
              <span data-v="added">+5</span>
              <span data-v="removed">−5</span>
              <Blocks added={5} removed={5} />
            </span>
            <span className={f.openLink}>Open ›</span>
          </div>
          <div className={f.hunkWrap}>
            <p className={f.path}>app/components/chrome/statusbar.tsx</p>
            <pre className={f.hunk}>
              <span className={f.hunkHead}>line 178</span>
              {HUNK.map(([k, old, now, text], i) => (
                <span key={i} className={`${f.line} ${f.in}`} data-k={k} style={at(0.55 + i * 0.07)}>
                  <span>{old}</span>
                  <span>{now}</span>
                  <span>{k === " " ? "" : k === "+" ? "+" : "−"}</span>
                  <code>{tint(text)}</code>
                </span>
              ))}
            </pre>
          </div>
        </div>
      </div>
    </Window>
  );
}

const APP_BOXES: Box[] = [
  { id: "home", label: "Home", col: 0, row: 0, v: "near" },
  { id: "canvas", label: "Canvas", col: 1, row: 0, sec: 1 },
  { id: "zoom", label: "Zoom", col: 2, row: 0, sec: 2 },
  { id: "diagram", label: "Diagram", col: 3, row: 0, sec: 3 },
  { id: "status", label: "StatusBar", col: 0, row: 1, v: "changed", tag: [5, 5] },
  { id: "pick", label: "PickMenu", col: 1, row: 1, sec: 4 },
  { id: "projects", label: "ProjectsDialog", col: 2, row: 1, sec: 5 },
  { id: "ppick", label: "Preview Pick", col: 3, row: 1, sec: 6 },
];
const APP_LINKS: Link[] = [
  { from: "home", to: "canvas", label: "renders" },
  { from: "canvas", to: "zoom", label: "wraps" },
  { from: "home", to: "status", label: "renders" },
  { from: "canvas", to: "pick", label: "context menu" },
];

/** statusbar.tsx in commit 6398cf4: the blueprint menu's new words. */
const HUNK: [" " | "+" | "-", number | "", number | "", string][] = [
  [" ", 179, 179, "  const items: MenuItem[] = ["],
  [" ", 180, 180, "    {"],
  ["-", 181, "", '      label: "Update blueprint to the code",'],
  ["+", "", 181, '      label: "Update Blueprint",'],
  [" ", 182, 182, '      disabled: generating || updating || p.status !== "ready",'],
  ["-", 185, "", '    { label: "Remake blueprint…", disabled: generating, onClick: () => remakeBlueprint(id) },'],
  ["+", "", 185, '    { label: "Remake Blueprint", disabled: generating, onClick: () => remakeBlueprint(id) },'],
  [" ", 186, 186, "    {"],
  ["-", 187, "", '      label: p.paused ? "Keep the blueprint updated" : "Stop updating the blueprint",'],
  ["+", "", 187, '      label: p.paused ? "Start Auto-Updates" : "Stop Auto-Updates",'],
];

/** Strings, comments and keywords, in the app's code colours. */
function tint(line: string) {
  return line.split(/("[^"]*"|\/\/.*$|\b(?:const|true|undefined)\b)/).map((p, i) =>
    i % 2 ? (
      <span key={i} data-tok={p.startsWith('"') ? "string" : p.startsWith("//") ? "comment" : "keyword"}>
        {p}
      </span>
    ) : (
      p
    ),
  );
}

/** GitHub's five squares, as the app draws them beside a change. */
function Blocks({ added, removed }: { added: number; removed: number }) {
  const green = Math.round((added / (added + removed)) * 5);
  return (
    <span className={f.blocks}>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} data-v={i < green ? "added" : "removed"} />
      ))}
    </span>
  );
}

/* ── the app running: the iOS Simulator, and the blueprint following ── */

const QUERY = "Ada Lovelace";

function RunScene() {
  return (
    <Window
      projects={
        <>
          <Project>blueprint</Project>
          <Project on>wikipedia</Project>
        </>
      }
      tabs={
        <Tab on icon={<BlueprintIcon />}>
          <span className={f.swap}>
            <span className={f.out} style={at(0, 5.5)}>
              Wikipedia
            </span>
            <span className={f.in} style={at(5.5)}>
              Reading An Article
            </span>
          </span>
        </Tab>
      }
    >
      <div className={`${f.page} ${f.out}`} style={{ "--ws": "370px", ...at(0, 5.5) } as CSSProperties}>
        <Head title="wikipedia" sub="The official Wikipedia app for iPhone and iPad" meta="1,402 files · commit 8e1f0c2" />
        <p className={f.cap}>
          How the parts connect<span>colours match the parts below</span>
        </p>
        <Diagram boxes={WIKI} links={WIKI_LINKS} w={210} gx={70} gy={50}>
          {/* What the phone shows, lit on the blueprint as Claude moves through it. */}
          <span className={`${f.lit} ${f.blip}`} style={{ left: "2.33%", top: "4.64%", ...at(1.7, 2.9) }} />
          <span className={`${f.lit} ${f.blip}`} style={{ left: "56.81%", top: "4.64%", ...at(2.9, 5.5) }} />
        </Diagram>
      </div>
      <div className={`${f.page} ${f.in}`} style={{ "--ws": "370px", ...at(5.6) } as CSSProperties}>
        <Head
          back={["Wikipedia"]}
          title="Reading An Article"
          eyebrow="Inside Wikipedia"
          sub="Fetch a page's mobile HTML, lay it out in a web view, and keep its place."
        />
        <ol className={f.flow}>
          {ARTICLE_STEPS.map(([title, body, file], i) => (
            <li key={title} className={f.in} style={at(5.8 + i * 0.12)}>
              <b>{title}</b>
              <span>{body}</span>
              <code>{file}</code>
            </li>
          ))}
        </ol>
      </div>
      <Workspace
        width="370px"
        tabs={
          <>
            <WsTab icon={<ClaudeIcon />} dot={[0, 6.4]}>
              claude 1
            </WsTab>
            <WsTab icon={<GlobeIcon />}>Preview</WsTab>
            <WsTab on icon={<PhoneIcon />}>
              iOS
            </WsTab>
          </>
        }
      >
        <div className={f.device}>
          <span className={f.deviceName}>iPhone 17 Pro</span>
          <span className={f.small}>Home</span>
          <span className={f.runApp}>
            <span className={f.swap}>
              <span className={f.out} style={at(0, 1.5)}>
                Building…
              </span>
              <span className={f.in} style={at(1.5)}>
                Run app
              </span>
            </span>
          </span>
        </div>
        <div className={`${f.building} ${f.out}`} style={at(0, 1.5)}>
          <i />
          <span>Building the app. It opens here when it&rsquo;s done.</span>
          <u>Show log</u>
        </div>
        <div className={f.dock}>
          <Phone />
        </div>
      </Workspace>
    </Window>
  );
}

const WIKI: Box[] = [
  { id: "feed", label: "Exploring The Feed", col: 0, row: 0, sec: 1 },
  { id: "search", label: "Searching Articles", col: 1, row: 0, sec: 2 },
  { id: "article", label: "Reading An Article", col: 1, row: 1, sec: 3 },
  { id: "saved", label: "Saving For Later", col: 0, row: 1, sec: 4 },
  { id: "api", label: "Wikimedia APIs", col: 1, row: 2, sec: 5 },
  { id: "sync", label: "Syncing Reading Lists", col: 0, row: 2, sec: 6 },
];
const WIKI_LINKS: Link[] = [
  { from: "feed", to: "search", label: "tap search" },
  { from: "search", to: "article", label: "opens a result" },
  { from: "article", to: "saved", label: "save" },
  { from: "article", to: "api", label: "fetches HTML" },
  { from: "saved", to: "sync", label: "syncs" },
];

const ARTICLE_STEPS: [string, string, string][] = [
  ["Open the page", "The result's URL becomes an article view, pushed onto the navigation stack.", "ArticleViewController.swift"],
  ["Fetch mobile HTML", "Asks the page content service for the article, served from the cache when it's fresh.", "ArticleFetcher.swift"],
  ["Lay it out", "Loads the HTML into a web view with the app's theme and font size.", "ArticleWebMessagingController.swift"],
  ["Keep your place", "Saves the scroll position, so the article reopens where you left it.", "ArticleViewController+Scroll.swift"],
];

/**
 * The Simulator's own screen, as the device pane shows it: the app running
 * in iOS, with Claude's pointer and its taps over it. Claude taps search,
 * types, and opens the first result.
 */
function Phone() {
  return (
    <div className={f.phone}>
      <div className={f.status}>
        <b>9:41</b>
        <i />
        <span>
          <svg viewBox="0 0 18 12">
            <path d="M1 9h2v2H1zM5 7h2v4H5zM9 4.5h2V11H9zM13 2h2v9h-2z" />
          </svg>
          <svg viewBox="0 0 16 12">
            <path d="M8 10.6 6.3 8.9a2.4 2.4 0 0 1 3.4 0zM3.9 6.5a5.8 5.8 0 0 1 8.2 0l-1.2 1.2a4.1 4.1 0 0 0-5.8 0zM1.5 4.1a9.2 9.2 0 0 1 13 0l-1.2 1.2a7.5 7.5 0 0 0-10.6 0z" />
          </svg>
          <em />
        </span>
      </div>

      {/* Launch: the app's mark while it opens. */}
      <div className={`${f.screen} ${f.out}`} data-launch style={at(0, 1.6)}>
        <b className={f.wordmark}>W</b>
      </div>

      {/* Explore. */}
      <div className={`${f.screen} ${f.blip}`} style={at(1.6, 2.9)}>
        <div className={f.wikiTop}>
          <b className={f.wordmark}>W</b>
        </div>
        <div className={f.searchField}>
          <SearchGlyph />
          Search Wikipedia
        </div>
        <p className={f.feedHead}>Featured article</p>
        <div className={f.card}>
          <div className={f.photo} data-sky />
          <b>Hubble Space Telescope</b>
          <span>Space telescope launched into low Earth orbit in 1990 and still in operation.</span>
        </div>
        <p className={f.feedHead}>Top read</p>
        <ol className={f.top}>
          {["Solar eclipse", "Large language model", "Olympic Games"].map((t, i) => (
            <li key={t}>
              <i>{i + 1}</i>
              <span>{t}</span>
            </li>
          ))}
        </ol>
        <TabBar />
      </div>

      {/* Search, typed into. */}
      <div className={`${f.screen} ${f.blip}`} style={at(2.9, 5.2)}>
        <div className={f.searchRow}>
          <div className={f.searchField} data-on>
            <SearchGlyph />
            <span className={f.typed} style={{ "--n": QUERY.length, ...at(3.2) } as CSSProperties}>
              {QUERY}
            </span>
            <i className={f.caret2} />
          </div>
          <span className={f.cancel}>Cancel</span>
        </div>
        <ul className={`${f.results} ${f.in}`} style={at(3.9)}>
          {RESULTS.map(([t, d]) => (
            <li key={t}>
              <b>{t}</b>
              <span>{d}</span>
            </li>
          ))}
        </ul>
        <div className={f.keyboard}>
          {["qwertyuiop", "asdfghjkl", "zxcvbnm"].map((row) => (
            <div key={row}>
              {row.split("").map((k) => (
                <i key={k}>{k}</i>
              ))}
            </div>
          ))}
          <div>
            <i data-wide>123</i>
            <i data-space>space</i>
            <i data-wide data-go>
              search
            </i>
          </div>
        </div>
      </div>

      {/* The article. */}
      <div className={`${f.screen} ${f.in}`} style={at(5.2)}>
        <div className={f.articleBar}>
          <span>‹ Search</span>
          <span className={f.articleTools}>
            <Ios d={IOS.lang} />
            <Ios d={IOS.share} />
          </span>
        </div>
        <div className={f.article}>
          <h4>Ada Lovelace</h4>
          <p className={f.desc}>English mathematician (1815–1852)</p>
          <div className={f.photo} data-portrait />
          <p>
            <b>Augusta Ada King, Countess of Lovelace</b> was an English mathematician and writer, chiefly known for her work
            on Charles Babbage&rsquo;s proposed mechanical general-purpose computer, the Analytical Engine.
          </p>
          <p className={f.h5}>Early life</p>
          <p>Lord Byron expected his child to be a &ldquo;glorious boy&rdquo; and was disappointed when Lady Byron gave birth to a girl.</p>
        </div>
        <div className={f.toolbarIOS}>
          {[IOS.back, IOS.forward, IOS.saved, IOS.toc, IOS.text].map((d) => (
            <Ios key={d} d={d} />
          ))}
        </div>
      </div>

      <span className={f.home} />
      <span className={f.tap} style={{ left: 126, top: 91, ...at(2.65) }} />
      <span className={f.tap} style={{ left: 90, top: 106, ...at(4.75) }} />
      <div className={f.hand}>
        <svg width="22" height="24" viewBox="0 0 22 24">
          <path d="M2 1.5 2 19.5 7 15 10.5 22.5 13.6 21 10.2 13.8 17 13.8Z" />
        </svg>
        <span>Claude</span>
      </div>
    </div>
  );
}

const RESULTS: [string, string][] = [
  ["Ada Lovelace", "English mathematician (1815–1852)"],
  ["Ada Lovelace Day", "International celebration of women in STEM"],
  ["Ada (programming language)", "Programming language named after her"],
];

function TabBar() {
  return (
    <div className={f.tabBar}>
      {(["Explore", "Places", "Saved", "History", "Search"] as const).map((t, i) => (
        <span key={t} data-on={i === 0 || undefined}>
          <Ios d={IOS[t]} />
          {t}
        </span>
      ))}
    </div>
  );
}

/** The app's toolbar and tab bar glyphs, drawn on iOS's 24 grid. */
const IOS = {
  Explore: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z",
  Places: "M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  Saved: "M6.5 3.5h11v17L12 16.5l-5.5 4z",
  History: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.5 2",
  Search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.2 15.2 20 20",
  back: "M14.5 5 8 12l6.5 7",
  forward: "M9.5 5 16 12l-6.5 7",
  saved: "M6.5 3.5h11v17L12 16.5l-5.5 4z",
  toc: "M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11",
  text: "M3 18 7.5 6 12 18M4.5 14h6M14 18l3-8 3 8M15 15.5h4",
  lang: "M3 5h9M7.5 3v2M5 5c.5 3.5 2.5 6 6 7.5M10 5c-.5 3.5-2.5 6-6 7.5M13 21l4-10 4 10M14.5 17.5h5",
  share: "M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1",
};

function Ios({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className={f.ios}>
      <path d={d} />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 16 16" className={f.stroke}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

const SCENES: Record<Drawing, () => ReactNode> = {
  claude: ClaudeScene,
  plan: PlanScene,
  review: ReviewScene,
  run: RunScene,
};

/* ── the app's own pieces ───────────────────────────────── */

/**
 * The desktop app's window in Classic: a black title bar with the open
 * projects and the tools (components/chrome/titlebar.tsx), the blueprint's tabs
 * on a black strip (tabs.tsx), the white sheet, and the status bar (statusbar.tsx).
 */
function Window({ projects, git, tabs, children }: { projects: ReactNode; git?: boolean; tabs: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className={`${f.black} ${f.titlebar}`}>
        <span className={f.lights}>
          <i />
          <i />
          <i />
        </span>
        {projects}
        <span className={f.add}>+</span>
        <span className={f.grow} />
        <Glyph on={git} d="M4 2v8M12 4a2 2 0 1 1 0 .01M4 12a2 2 0 1 1 0 .01M12 6a6 6 0 0 1-6 6" />
        <Glyph d="M4 1.5h5.5L12 4v10.5H4zM9.5 1.5V4H12" />
        <i className={f.divider} />
        <Glyph d="M1.5 2.5h13v11h-13zM4.5 6.5 6.5 8l-2 1.5M8.5 10h3" />
        <Glyph d="M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
      </header>
      <div className={`${f.black} ${f.strip}`}>
        {tabs}
        <span className={f.add}>+</span>
      </div>
      <div className={f.main}>{children}</div>
      <footer className={`${f.black} ${f.statusbar}`}>
        <span>
          <svg viewBox="0 0 16 16" className={f.stroke}>
            <circle cx="8" cy="8" r="2.5" />
            <path d="M1.5 8h4M10.5 8h4" />
          </svg>
          Blueprint ⌃
        </span>
        <span className={f.grow} />
        <span>
          Go to <kbd>⌘P</kbd>
        </span>
        <span>
          <TerminalIcon />
          Workspace <kbd>⌘`</kbd>
        </span>
      </footer>
    </>
  );
}

/** An open project in the title bar. */
function Project({ on, children }: { on?: boolean; children: ReactNode }) {
  return (
    <span className={f.project} data-on={on || undefined}>
      {children}
    </span>
  );
}

function Tab({ on, icon, children }: { on?: boolean; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={f.tab} data-on={on || undefined}>
      {icon}
      {children}
      {on ? <span className={f.x}>×</span> : null}
    </span>
  );
}

/** The floating window of terminals, previews and phones, over the blueprint's right edge. */
function Workspace({ width, tabs, children }: { width: string; tabs: ReactNode; children: ReactNode }) {
  return (
    <aside className={f.ws} style={{ width }}>
      <div className={`${f.black} ${f.wsTabs}`}>
        {tabs}
        <span className={f.wsBtn}>+</span>
        <span className={f.wsRest} />
        <span className={f.wsBtn}>✕</span>
      </div>
      <div className={f.wsBody}>{children}</div>
    </aside>
  );
}

/** `dot`: when the tab's Claude starts working and when it is done. */
function WsTab({ on, icon, dot, children }: { on?: boolean; icon: ReactNode; dot?: [number, number]; children: ReactNode }) {
  return (
    <span className={f.wsTab} data-on={on || undefined}>
      {icon}
      {children}
      {dot ? (
        <span className={f.swap}>
          <Dot status="working" className={f.blip} style={at(dot[0], dot[1])} />
          <Dot status="done" className={f.in} style={at(dot[1])} />
        </span>
      ) : null}
      {on ? <span className={f.x}>×</span> : null}
    </span>
  );
}

/** components/agent/status-dot.tsx: yellow while Claude works, red when it needs you, green when done. */
function Dot({ status, className, style }: { status: "working" | "waiting" | "done"; className?: string; style?: CSSProperties }) {
  return <span className={`${f.dot} ${className ?? ""}`} data-status={status} style={style} />;
}

/** Claude Code's own header, as it opens in a tab. */
function Hello() {
  return (
    <div className={f.hello}>
      <b>✻</b>
      <span>
        <b>Claude Code</b>
        <br />
        <span className={f.res}>Opus 5.5 · ~/Code/blueprint</span>
      </span>
    </div>
  );
}

function Prompt({ children }: { children?: ReactNode }) {
  return (
    <>
      <div className={f.prompt}>
        &gt; {children}
        <i className={f.cursor} />
      </div>
      <p className={f.hint}>? for shortcuts</p>
    </>
  );
}

/**
 * A level's header (components/blueprint/header.tsx): the way back as one
 * toolbar row, then the bracketed eyebrow, the title and its line.
 */
function Head({
  back,
  title,
  eyebrow,
  sub,
  meta,
  action,
}: {
  back?: string[];
  title: string;
  eyebrow?: string;
  sub?: string;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <header className={f.head}>
      {back ? (
        <div className={f.trail}>
          {back.map((b, i) => (
            <span key={b}>
              {i > 0 ? <i>›</i> : null}
              <span className={f.ghost}>
                {i === 0 ? "← " : ""}
                {b}
              </span>
            </span>
          ))}
          <i>›</i>
          <span className={f.here}>{title}</span>
          <span className={f.grow} />
          {action}
        </div>
      ) : null}
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h3 className={f.title}>{title}</h3>
      {sub ? <p className={f.sub}>{sub}</p> : null}
      {meta ? <p className={f.meta}>{meta}</p> : null}
    </header>
  );
}

/** components/ui/state.tsx's bracket label, `[ PARTS ]`. */
function Eyebrow({ children }: { children: ReactNode }) {
  return <span className={f.eyebrow}>{children}</span>;
}

/* ── a diagram, as components/blueprint/blocks.tsx draws one ── */

type Box = {
  id: string;
  label: string;
  sub?: string;
  col: number;
  row: number;
  /** Which of the level's parts the box opens, so its colour matches that part's. */
  sec?: number;
  /** A change on it: amber where the code changed, green where it is new, dashed where a box calls into one. */
  v?: Change | "near";
  /** The change's size, on the box's top edge. */
  tag?: [number, number];
};
type Link = { from: string; to: string; label: string; v?: Change };

const BOX_H = 58;
const TINTS = {
  added: { ink: "var(--color-diff-add-ink)", surface: "var(--color-diff-add-surface)", line: "var(--color-diff-add-line)", mark: "+" },
  changed: { ink: "var(--color-amber-ink)", surface: "var(--color-amber-surface)", line: "var(--color-amber-line)", mark: "~" },
};

/**
 * Boxes on a grid, `w` wide with `gx`/`gy` between them; a link runs edge to
 * edge between two boxes in one row or one column. `recede`: a diff, where
 * what didn't change fades.
 */
function Diagram({
  boxes,
  links,
  w,
  gx,
  gy,
  recede,
  children,
}: {
  boxes: Box[];
  links: Link[];
  w: number;
  gx: number;
  gy: number;
  recede?: boolean;
  children?: ReactNode;
}) {
  const pos = (b: Box) => ({ x: 12 + b.col * (w + gx), y: 14 + b.row * (BOX_H + gy) });
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const W = 24 + (Math.max(...boxes.map((b) => b.col)) + 1) * (w + gx) - gx;
  const H = 28 + (Math.max(...boxes.map((b) => b.row)) + 1) * (BOX_H + gy) - gy;
  return (
    <div className={f.pic}>
      <svg viewBox={`0 0 ${W} ${H}`}>
        <defs>
          {(["plain", "added", "changed"] as const).map((v) => (
            <marker key={v} id={`d-${v}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1 1.2L7 4 1 6.8z" fill={v === "plain" ? "var(--color-wire)" : TINTS[v].line} />
            </marker>
          ))}
        </defs>
        {links.map((l) => {
          const a = pos(byId.get(l.from)!);
          const b = pos(byId.get(l.to)!);
          const t = l.v ? TINTS[l.v] : null;
          const across = a.y === b.y;
          const d = across
            ? a.x < b.x
              ? `M${a.x + w} ${a.y + BOX_H / 2}H${b.x - 2}`
              : `M${a.x} ${a.y + BOX_H / 2}H${b.x + w + 2}`
            : a.y < b.y
              ? `M${a.x + w / 2} ${a.y + BOX_H}V${b.y - 2}`
              : `M${a.x + w / 2} ${a.y}V${b.y + BOX_H + 2}`;
          const x = across ? (a.x + b.x + w) / 2 : a.x + w / 2 + 8;
          const y = across ? a.y + BOX_H / 2 - 8 : (a.y + b.y + BOX_H) / 2 + 4;
          return (
            <g key={`${l.from}-${l.to}`} opacity={recede && !t ? 0.6 : 1}>
              <path d={d} fill="none" stroke={t?.line ?? "var(--color-wire)"} strokeWidth={t ? 2 : 1.25} markerEnd={`url(#d-${l.v ?? "plain"})`} />
              <text
                x={x}
                y={y}
                textAnchor={across ? "middle" : "start"}
                fontSize="12"
                fill={t?.ink ?? "var(--color-muted-slate)"}
                stroke="var(--color-paper)"
                strokeWidth="4"
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                {l.label}
              </text>
            </g>
          );
        })}
        {boxes.map((b) => {
          const { x, y } = pos(b);
          const t = b.v && b.v !== "near" ? TINTS[b.v] : null;
          const sec = b.sec ? { fill: `var(--color-sec-${b.sec}-surface)`, ink: `var(--color-sec-${b.sec}-ink)` } : null;
          const fill = t?.surface ?? sec?.fill ?? "var(--color-card)";
          const ink = t?.ink ?? sec?.ink ?? "var(--color-ink)";
          const stroke = t?.line ?? (b.v === "near" ? TINTS.changed.line : (sec?.ink ?? "var(--color-border-strong)"));
          const fade = recede && !b.v;
          return (
            <g key={b.id} opacity={fade ? 0.45 : 1}>
              <rect
                x={x}
                y={y}
                width={w}
                height={BOX_H}
                rx="3"
                fill={fill}
                stroke={stroke}
                strokeWidth={t ? 2 : 1}
                strokeOpacity={!b.v && sec ? 0.55 : 1}
                strokeDasharray={b.v === "near" ? "3 3" : undefined}
              />
              <text
                x={x + w / 2}
                y={b.sub ? y + 26 : y + BOX_H / 2 + 6}
                textAnchor="middle"
                fontFamily="var(--font-display), Georgia, serif"
                fontSize="18"
                letterSpacing="-0.01em"
                fill={ink}
              >
                {b.label}
              </text>
              {b.sub ? (
                <text x={x + w / 2} y={y + 44} textAnchor="middle" fontSize="11.5" fill="var(--color-faint)">
                  {b.sub}
                </text>
              ) : null}
              {t ? (
                <text x={x + w - 8} y={y + 15} textAnchor="end" fontSize="12" fontWeight="700" fill={t.ink}>
                  {t.mark}
                </text>
              ) : null}
              {b.tag && t ? (
                <g>
                  <rect x={x + 8} y={y - 9} width={`+${b.tag[0]} −${b.tag[1]}`.length * 6.6 + 14} height={18} rx="9" fill={t.surface} stroke={t.line} />
                  <text x={x + 15} y={y + 4} fontSize="11" fontWeight="600" fontFamily="var(--font-mono)">
                    <tspan fill={TINTS.added.ink}>+{b.tag[0]}</tspan>
                    <tspan fill="var(--color-diff-remove-ink)"> −{b.tag[1]}</tspan>
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
      {children}
    </div>
  );
}

/* ── icons, as the app draws them ───────────────────────── */

function Glyph({ d, on }: { d: string; on?: boolean }) {
  return (
    <span className={f.glyph} data-on={on || undefined}>
      <svg viewBox="0 0 16 16">
        <path d={d} />
      </svg>
    </span>
  );
}

function ClaudeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="#d97757">
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg viewBox="0 0 16 16" className={f.stroke}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M4.5 6.5 6.5 8l-2 1.5M8.5 10h3" />
    </svg>
  );
}

function BlueprintIcon() {
  return (
    <svg viewBox="0 0 16 16" className={f.stroke}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="M7.5 2.5v6h6M2.5 10.5h3" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 16 16" className={f.stroke}>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.7 1.8 2.5 3.8 2.5 6S9.7 12.2 8 14C6.3 12.2 5.5 10.2 5.5 8S6.3 3.8 8 2Z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 16 16" className={f.stroke}>
      <rect x="4" y="1.5" width="8" height="13" rx="2" />
      <path d="M7 12h2" />
    </svg>
  );
}

/** A page with a check: a plan's tab. */
function PlanIcon() {
  return (
    <svg viewBox="0 0 16 16" className={f.stroke}>
      <path d="M4 1.5h5.5L12 4v10.5H4z" />
      <path d="m6.2 9.2 1.4 1.4 2.4-2.8" />
    </svg>
  );
}
