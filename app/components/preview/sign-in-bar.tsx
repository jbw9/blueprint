"use client";

import type { Signing } from "@/components/preview/parts";
import { cn } from "@/lib/client/utils";

/** Claude waiting on the user to sign in to a site in the preview (components/preview/tools.ts `signIn`). */
export function SignInBar({ signing, onKeep, onDone }: { signing: Signing; onKeep: (project: boolean) => void; onDone: (done: boolean) => void }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border-gray bg-claude/8 px-3 py-2 text-[12px]">
      <span className="min-w-0 flex-1 text-ink">
        Claude needs you to sign in to <b className="font-medium">{signing.site}</b>. Sign in on the page yourself: Claude never sees your
        password, and waits until you are done.
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-muted-slate">
        Keep for
        <span role="radiogroup" aria-label="Keep this sign-in for" className="flex items-center bg-surface-container p-0.5">
          {[
            { label: "All projects", project: false },
            { label: "Only this project", project: true },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={signing.project === o.project}
              onClick={() => onKeep(o.project)}
              className={cn(
                "h-5 cursor-pointer px-2 text-[11.5px]",
                signing.project === o.project ? "bg-card text-ink shadow-[0_0_0_1px_var(--color-border-gray)]" : "text-muted-slate hover:text-ink",
              )}
            >
              {o.label}
            </button>
          ))}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => onDone(false)}
          className="cursor-pointer px-2.5 py-0.5 text-[12px] text-muted-slate hover:text-ink"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={() => onDone(true)}
          className="cursor-pointer bg-accent px-2.5 py-0.5 text-[12px] text-on-accent hover:opacity-90"
        >
          I&apos;m signed in
        </button>
      </span>
    </div>
  );
}
