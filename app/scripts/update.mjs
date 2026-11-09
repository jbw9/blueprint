// usage: node scripts/update.mjs <latest.json's url or path>...
//   Each latest.json is tried in turn until one answers; each names its own host's archives.
//   run from the installed server (<app data>/server) by lib/server/update.ts, and by CI on a fresh
//   install (.github/scripts/check-update.sh). When latest.json names a newer release than this
//   server's release.json, the release for this system is downloaded, checked against its sha256 and
//   unpacked to <app data>/update, placed as app/scripts/install.sh would place it; the app swaps it in
//   when it next quits or starts (src-tauri/src/update.rs). Unpacked beside it first, so an update cut
//   short is never taken for a finished one.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = path.dirname(server);
const staged = path.join(data, "update");
const tmp = path.join(data, "update.tmp");

const versionIn = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "release.json"), "utf8")).version;
  } catch {
    return null;
  }
};
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  const i = x.findIndex((n, k) => n !== y[k]);
  return i >= 0 && x[i] > y[i];
};
// CI hands it files; the app, S3 and then GitHub.
const open = async (where, timeout) => {
  if (!/^https?:/.test(where)) return fs.createReadStream(where.startsWith("file:") ? fileURLToPath(where) : where);
  const r = await fetch(where, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${where}: ${r.status}`);
  return Readable.fromWeb(r.body);
};

const current = versionIn(server);
if (!current) throw new Error("This Blueprint was built from source, so it has no release to update.");
let latest;
for (const where of process.argv.slice(2)) {
  try {
    const chunks = [];
    for await (const c of await open(where, 30_000)) chunks.push(c);
    latest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    break;
  } catch (e) {
    console.error(e.message);
  }
}
if (!latest) throw new Error("No latest.json answered.");
const system = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "arm64" : "x86_64"}`;
const asset = latest.assets?.[system];
if (!asset || !newer(latest.version, current) || versionIn(path.join(staged, "server")) === latest.version) process.exit(0);

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const archive = path.join(tmp, "blueprint.tar.gz");
const hash = createHash("sha256");
await pipeline(
  await open(asset.url, 30 * 60_000),
  async function* (source) {
    for await (const c of source) {
      hash.update(c);
      yield c;
    }
  },
  fs.createWriteStream(archive),
);
if (hash.digest("hex") !== asset.sha256) throw new Error(`${asset.url} isn't the file latest.json describes.`);
// Windows' own tar: Git's reads D:\... as a remote host.
const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
execFileSync(tar, ["-xzf", archive, "-C", tmp], { stdio: "inherit", windowsHide: true });
fs.rmSync(archive);

// The release carries .next/node_modules's links as links.json (.github/scripts/pack-release.sh). They
// point where the server will be once it is swapped in, and the Node and PATH install.sh recorded stay.
const next = path.join(tmp, "server");
const dir = path.join(next, ".next", "node_modules");
const list = path.join(dir, "links.json");
for (const [name, to] of Object.entries(JSON.parse(fs.readFileSync(list, "utf8")))) fs.symlinkSync(path.join(server, to), path.join(dir, name), "junction");
fs.rmSync(list);
fs.copyFileSync(path.join(server, "env.json"), path.join(next, "env.json"));

fs.rmSync(staged, { recursive: true, force: true });
fs.renameSync(tmp, staged);
console.log(latest.version);
