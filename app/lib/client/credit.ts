/** Blueprint credit as this machine has it (app/api/credit, lib/server/credit.ts). */
export interface Credit {
  available: boolean;
  on: boolean;
  device: string | null;
  used?: number;
  limit?: number;
  resets?: string | null;
  windowHours?: number;
  reason?: string;
  relay: { url: string; token: string } | null;
}

const CHANGED = "blueprint:credit-changed";

export const readCredit = () =>
  fetch("/api/credit")
    .then((r) => (r.ok ? (r.json() as Promise<Credit>) : null))
    .catch(() => null);

export async function setCredit(on: boolean) {
  await fetch("/api/credit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on }) });
  window.dispatchEvent(new Event(CHANGED));
}

export const onCreditChanged = (f: () => void) => {
  window.addEventListener(CHANGED, f);
  return () => window.removeEventListener(CHANGED, f);
};

/** Where a new Claude tab sends its calls with the credit on; null leaves it on the user's own Claude Code. */
export const creditRelay = async () => (await readCredit())?.relay ?? null;
