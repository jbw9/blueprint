// usage (from app/): npx -y tsx --tsconfig tsconfig.json scripts/generate/ask.mts <bluprint dir> <questions.json> [--repo <checkout>] [--modes bluprint,grep,both] [--only id,id]
//   Scores a bluprint on developer questions with answer keys (scripts/generate/questions/): an agent
//   answers each through the bluprint tools alone (bluprint), the code tools alone (grep), or both, and a
//   grader checks every fact of the key. Writes <bluprint dir>/ask.json; prints the score by kind and the
//   tokens and turns each mode took. SLOP_ASK picks the answering model (default sonnet).
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
await (await import("./ask")).score(process.argv.slice(2));
