"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/client/utils";
import { DIALOG, Overlay, PRIMARY, QUIET } from "@/components/ui/dialog";
import { claudePath } from "@/lib/client/claude";
import { CREDIT_SHORT, creditShort, projectAction } from "@/lib/client/api";

/*
 * A blueprint too big for what is left of Blueprint credit's maps this week
 * (lib/server/vault.ts, generate): rather than move it to the reader's own Claude
 * Code without a word, the run waits and they choose. projectAction raises it.
 */

const usd = (x: number) => `$${x.toFixed(2)}`;

export function CreditShortDialog() {
  const router = useRouter();
  const [asked, setAsked] = useState(() => creditShort.asked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const show = () => {
      setAsked(creditShort.asked);
      setError(null);
    };
    window.addEventListener(CREDIT_SHORT, show);
    return () => window.removeEventListener(CREDIT_SHORT, show);
  }, []);
  if (!asked) return null;
  const close = () => {
    creditShort.asked = null;
    setAsked(null);
  };
  const own = async () => {
    setBusy(true);
    setError(null);
    try {
      const { body } = asked;
      await projectAction({ action: "regenerate", id: asked.id, claude: body.claude ?? (await claudePath()), explain: body.explain, full: body.full, own: true });
      close();
      router.push(`/?blueprint=${encodeURIComponent(asked.id)}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const { files, usd: cost, left, resets } = asked.short;
  const when = resets ? new Date(resets).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : null;
  return (
    <Overlay onClose={close}>
      <div role="dialog" aria-label="Not enough Blueprint credit" className={cn(DIALOG, "max-w-[520px]")}>
        <header className="border-b border-border-gray px-5 py-3">
          <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">Too big for the credit left this week</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-slate">{asked.name}</p>
        </header>
        <div className="flex flex-col gap-2 px-5 py-5 text-[13.5px] leading-relaxed text-on-surface-variant">
          <p>
            Its {files.toLocaleString()} source files would cost about {usd(cost)} to map, and {usd(left)} of this week&apos;s Blueprint credit
            for maps is left{when ? `, until ${when}` : ""}. On the credit it would stop halfway.
          </p>
          <p>You can map it with your own Claude Code instead, on your Claude plan, or wait until the credit resets.</p>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border-gray bg-surface px-5 py-3">
          {error ? <p className="mr-auto text-[12.5px] text-clay-ink">{error}</p> : null}
          <button type="button" onClick={close} className={QUIET}>
            Not now
          </button>
          <button type="button" onClick={() => void own()} disabled={busy} className={PRIMARY}>
            {busy ? "Starting…" : "Use my Claude Code"}
          </button>
        </footer>
      </div>
    </Overlay>
  );
}
