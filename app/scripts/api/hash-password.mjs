// usage: node scripts/api/hash-password.mjs <password> → the `hash` for the dashboard's `admin / pw` item (admin.mjs).
import { randomBytes, scryptSync } from "node:crypto";

const pw = process.argv[2];
if (!pw) throw new Error("usage: node scripts/api/hash-password.mjs <password>");
const salt = randomBytes(16);
console.log(`${salt.toString("hex")}:${scryptSync(pw, salt, 32).toString("hex")}`);
