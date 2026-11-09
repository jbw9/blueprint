import type { CreditShort } from "@/lib/server/credit";

/** A POST to /api/projects (app/api/projects/route.ts), throwing the error it answers with. */
export async function projectAction(body: Record<string, unknown>) {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? "Something went wrong.");
  // The blueprint did not start: too big for the credit left, so the reader chooses (components/projects/credit-short.tsx).
  if (out?.short && out.id) {
    creditShort.asked = { id: out.id, name: out.name ?? out.id, short: out.short, body };
    window.dispatchEvent(new CustomEvent(CREDIT_SHORT));
  }
  return out;
}

export const CREDIT_SHORT = "bp:credit-short";

/**
 * The blueprint waiting on the reader's choice. Kept here rather than in the dialog: the page it
 * was asked from can give way to the project's own (an import opens it) before the dialog is drawn.
 */
export const creditShort: {
  asked: { id: string; name: string; short: CreditShort; body: Record<string, unknown> } | null;
} = { asked: null };
