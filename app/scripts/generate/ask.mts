// usage (from app/): npx -y tsx --tsconfig tsconfig.json scripts/generate/ask.mts <blueprint dir> <questions.json> [--repo <checkout>] [--modes blueprint,grep,both] [--only id,id]
//   Scores a blueprint on developer questions with answer keys (scripts/generate/questions/): an agent
//   answers each through the blueprint tools alone (blueprint), the code tools alone (grep), or both, and a
//   grader checks every fact of the key. Writes <blueprint dir>/ask.json; prints the score by kind and the
//   tokens and turns each mode took. SLOP_ASK picks the answering model (default sonnet).
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
await (await import("./ask")).score(process.argv.slice(2));
