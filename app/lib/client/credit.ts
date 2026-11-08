/** Blueprint credit as this machine has it (app/api/credit, lib/server/credit.ts). */
import type { CreditStatus, Meter } from "@/lib/server/credit";

export type { Meter };

export interface Credit extends CreditStatus {
  relay: { url: string; token: string } | null;
}

const CHANGED = "blueprint:credit-changed";
const changed = () => window.dispatchEvent(new Event(CHANGED));

export const readCredit = () =>
  fetch("/api/credit")
    .then((r) => (r.ok ? (r.json() as Promise<Credit>) : null))
    .catch(() => null);

const post = (body: object) =>
  fetch("/api/credit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<unknown>);

export async function setCredit(on: boolean) {
  await post({ on });
  changed();
}

/** GitHub's code for the reader to enter at `url`, or why there is none. */
export const startSignIn = () => post({ signin: "start" }) as Promise<{ code: string; url: string; interval: number } | { reason: string }>;

/** Whether the code has been entered yet: signed in, ask again in `wait` seconds, or why not. */
export async function pollSignIn() {
  const r = (await post({ signin: "poll" })) as { login: string } | { wait: number } | { reason: string };
  if ("login" in r) changed();
  return r;
}

export async function signOut() {
  await post({ signout: true });
  changed();
}

export const onCreditChanged = (f: () => void) => {
  window.addEventListener(CHANGED, f);
  return () => window.removeEventListener(CHANGED, f);
};

/** Where a new Claude tab sends its calls with the credit on; null leaves it on the user's own Claude Code. */
export const creditRelay = async () => (await readCredit())?.relay ?? null;

/** How much of a window is used, 0–100; null when it has no cap. */
export const percent = (m: Meter) => (m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : null);

/** When a window opens again, as Claude Code's /usage says it: a time today, else the day and time. */
export function resetsAt(m: Meter) {
  if (!m.resets) return null;
  const d = new Date(m.resets);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}
