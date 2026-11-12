"use client";

import { useEffect, useState } from "react";
import { answerQuietMedia, cancelDictation, stopDictation, useDictation, useDictationKey } from "@/lib/agent/dictate";
import { cn } from "@/lib/client/utils";
import { dictateKeys } from "@/components/ui/button";
import { useMac } from "@/lib/client/platform";

const BUTTON = "rounded-md cursor-pointer px-3 py-1 text-[13px]";

/**
 * On-device dictation's only chrome (lib/agent/dictate.ts): a pill over the bottom
 * of the window while it listens or writes out, and for a moment after when
 * it put nothing in. Mounted once; it also holds the Control+Option keys.
 */
export function Dictation() {
  useDictationKey();
  const d = useDictation();
  const mac = useMac();
  // The note on an empty result goes after a few seconds; a new one brings it back.
  const [faded, setFaded] = useState<typeof d | null>(null);
  useEffect(() => {
    if (d.phase !== "idle" || !d.error) return;
    const t = setTimeout(() => setFaded(d), 4000);
    return () => clearTimeout(t);
  }, [d]);
  if (d === faded || (d.phase === "idle" && !d.error && !d.ask)) return null;
  const listening = d.phase === "listening";
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-10 z-50 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-border-gray bg-card px-5 py-3 font-mono text-[14px] text-ink shadow-lift">
        <span
          aria-hidden
          className={cn("h-2.5 w-2.5 shrink-0 rounded-full", listening ? "animate-pulse bg-clay-ink" : d.phase === "working" ? "bg-accent" : "bg-faint")}
        />
        {d.ask ? (
          <>
            <span>While you talk, pause Music and Spotify and mute other sound?</span>
            <button type="button" onClick={() => answerQuietMedia(true)} className={cn(BUTTON, "bg-accent text-on-accent hover:bg-accent-strong")}>
              Yes
            </button>
            <button type="button" onClick={() => answerQuietMedia(false)} className={cn(BUTTON, "border border-border-gray hover:bg-surface-container")}>
              No
            </button>
          </>
        ) : listening ? `Listening… let go of ${dictateKeys(mac)}` : d.phase === "working" ? "Writing it out…" : d.error}
        {listening ? (
          <>
            <button type="button" onClick={() => void stopDictation()} className={cn(BUTTON, "bg-accent text-on-accent hover:bg-accent-strong")}>
              Done
            </button>
            <button type="button" onClick={cancelDictation} className={cn(BUTTON, "border border-border-gray hover:bg-surface-container")}>
              Cancel
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
