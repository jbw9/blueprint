// usage (from app/): npx -y tsx --tsconfig tsconfig.json scripts/generate/eval.mts [--stability <name> <fresh cut.json>]
//   One row per bluprint under bluprints/: shape of the tree, check problems,
//   verify pass rate, cost and time. --stability compares a bluprint's cut with a second, fresh cut.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { evaluate, stability } from "./evaluate";

const args = process.argv.slice(2);
if (args[0] === "--stability") {
  console.log(stability(args[1], args[2]));
  process.exit(0);
}
const names = (existsSync("bluprints") ? readdirSync("bluprints") : []).filter((d) => existsSync(`bluprints/${d}/bluprint.json`)).sort();
const rows = names.map((n) => evaluate(n, JSON.parse(readFileSync(`bluprints/${n}/bluprint.json`, "utf8"))));
console.table(rows);
