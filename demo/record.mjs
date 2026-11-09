import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "overview.gif");
const exe = process.env.BLUEPRINT_EXE ?? join(process.env.LOCALAPPDATA ?? "", "Programs", "Blueprint", "blueprint.exe");
const project = process.env.BLUEPRINT_DEMO_PROJECT ?? "understand-slop";
const theme = process.env.BLUEPRINT_DEMO_THEME ?? "dark";
const port = 9333;

const work = mkdtempSync(join(tmpdir(), "blueprint-demo-"));
const frames = join(work, "frames");
mkdirSync(frames);

const app = spawn(exe, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(work, "profile"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  stdio: "ignore",
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 120; i++) {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
    const page = list.find((t) => t.type === "page" && t.url.startsWith("http://localhost:3123"));
    if (page) return page.webSocketDebuggerUrl;
    await sleep(500);
  }
  throw new Error("Blueprint did not open a page with the debug port.");
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let next = 0;
const waiting = new Map();
const listeners = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) {
    const { ok, fail } = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.error) fail(new Error(m.error.message));
    else ok(m.result);
  } else if (m.method) listeners.get(m.method)?.(m.params);
});
const send = (method, params = {}) =>
  new Promise((ok, fail) => {
    const id = ++next;
    waiting.set(id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

const CURSOR = `(() => {
  if (document.getElementById("demo-cursor")) return;
  const c = document.createElement("div");
  c.id = "demo-cursor";
  c.innerHTML = '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.5 15 L17.5 15 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  c.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px)";
  document.documentElement.appendChild(c);
  addEventListener("mousemove", (e) => { c.style.transform = "translate(" + (e.clientX - 2) + "px," + (e.clientY - 2) + "px)"; }, true);
  addEventListener("mousedown", (e) => {
    const r = document.createElement("div");
    r.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;width:36px;height:36px;border-radius:50%;border:2px solid #8ea2ff;left:" + (e.clientX - 18) + "px;top:" + (e.clientY - 18) + "px;transition:transform .45s ease-out,opacity .45s ease-out;transform:scale(.3);opacity:1";
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = "scale(1.4)"; r.style.opacity = "0"; });
    setTimeout(() => r.remove(), 500);
  }, true);
})()`;

const FIND = `(label, below, above, nth) => {
  const hits = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walk.currentNode; el; el = walk.nextNode()) {
    if (el.textContent.trim() !== label || [...el.children].some((k) => k.textContent.trim() === label)) continue;
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    if (r.width && r.height && y > below && y < above) hits.push({ x: r.left + r.width / 2, y, top: r.top });
  }
  hits.sort((a, b) => a.top - b.top);
  return hits[nth] ?? null;
}`;

async function find(label, { below = 0, above = 1e9, nth = 0, timeout = 20000 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const hit = await evaluate(`(${FIND})(${JSON.stringify(label)}, ${below}, ${above}, ${nth})`);
    if (hit) return hit;
    await sleep(200);
  }
  throw new Error(`"${label}" did not appear.`);
}

async function box(id, { timeout = 20000 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const hit = await evaluate(`(() => {
      const r = document.querySelector('a[data-opens=${JSON.stringify(id)}]')?.getBoundingClientRect();
      return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    })()`);
    if (hit) return hit;
    await sleep(200);
  }
  throw new Error(`The box for "${id}" did not appear.`);
}

let mouse ={ x: 760, y: 470 };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
async function move(to, ms = 700) {
  const from = mouse;
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    mouse = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: mouse.x, y: mouse.y });
    await sleep(16);
  }
}
async function click(to, ms) {
  await move(to, ms);
  await sleep(250);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: mouse.x, y: mouse.y, button: "left", clickCount: 1 });
  await sleep(70);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: mouse.x, y: mouse.y, button: "left", clickCount: 1 });
}
async function scroll(dy, ms = 900) {
  const steps = Math.round(ms / 16);
  let done = 0;
  for (let i = 1; i <= steps; i++) {
    const to = Math.round(dy * ease(i / steps));
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: mouse.x, y: mouse.y, deltaX: 0, deltaY: to - done });
    done = to;
    await sleep(16);
  }
}

const shots = [];
listeners.set("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const file = join(frames, `${String(shots.length).padStart(5, "0")}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  shots.push({ file, at: metadata.timestamp });
  send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("blueprint.settings", JSON.stringify({ ...JSON.parse(localStorage.getItem("blueprint.settings") || "{}"), theme: ${JSON.stringify(theme)} }));
      localStorage.setItem("blueprint.projects.open", ${JSON.stringify(JSON.stringify([project]))});
      addEventListener("DOMContentLoaded", ${CURSOR.replace(/^\(|\)\(\)$/g, "")});`,
  });
  await send("Page.navigate", { url: `http://localhost:3123/?blueprint=${encodeURIComponent(project)}` });
  await sleep(4000);
  if ((await evaluate("document.documentElement.dataset.theme")) !== theme) throw new Error(`The page did not open in the ${theme} theme.`);
  await evaluate(CURSOR);
  const tab = await find("Blueprint", { above: 70 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: tab.x, y: tab.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: tab.x, y: tab.y, button: "left", clickCount: 1 });
  await box("components");
  for (const end = Date.now() + 600000; await evaluate(`/Updating the blueprint|Blueprint updated/.test(document.body.innerText)`); await sleep(1000))
    if (Date.now() > end) throw new Error("The blueprint was still updating after 10 minutes.");
  await sleep(1500);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: mouse.x, y: mouse.y });
  await sleep(1500);

  await send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  const start = Date.now() / 1000;
  await sleep(2200);

  const ui = await box("components");
  await move(ui, 900);
  await sleep(1600);
  await click(ui, 200);
  await box("co-agent-workspace");
  await sleep(1800);

  await click(await box("co-agent-workspace"), 900);
  await box("co-workspace-storage");
  await sleep(1500);
  await scroll(1300, 1400);
  await sleep(1000);

  await click(await box("co-workspace-storage"), 800);
  const step = await find("Restore sessions once on launch", { below: 300 });
  await sleep(2200);
  const code = await evaluate(`(() => {
    const icons = [...document.querySelectorAll("button, a, [role=button]")].filter((b) => b.textContent.trim() === "</>" || b.getAttribute("aria-label")?.match(/code/i));
    const near = icons.map((b) => b.getBoundingClientRect()).filter((r) => Math.abs(r.top + r.height / 2 - ${step.y}) < 14);
    return near[0] ? { x: near[0].left + near[0].width / 2, y: near[0].top + near[0].height / 2 } : null;
  })()`);
  await click(code ?? step, 1000);
  await find("Step 5 · Restore sessions once on launch").catch(() => null);
  await sleep(4500);

  await send("Page.stopScreencast");
  const end = Date.now() / 1000;
  await sleep(300);

  const list = shots.filter((s) => s.at >= start - 0.05);
  const lines = list.flatMap((s, i) => [`file '${s.file.replace(/\\/g, "/")}'`, `duration ${((list[i + 1]?.at ?? end) - s.at).toFixed(3)}`]);
  lines.push(`file '${list.at(-1).file.replace(/\\/g, "/")}'`);
  writeFileSync(join(work, "frames.txt"), lines.join("\n"));
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(work, "frames.txt"),
    "-vf", "fps=15,scale=1100:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
    "-loop", "0", out,
  ], { stdio: "inherit" });
  console.log(`${out} (${list.length} frames, ${(end - start).toFixed(1)} s)`);
} finally {
  ws.close();
  app.kill();
  await sleep(1000);
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
