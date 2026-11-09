"use client";

import { cn } from "@/lib/client/utils";
import type { Status } from "@/lib/client/open-projects";

export const DOT: Record<Status, { colour: string; label: string }> = {
  working: { colour: "bg-amber-line", label: "Working" },
  waiting: { colour: "bg-clay-ink", label: "Needs you" },
  done: { colour: "bg-[var(--color-diff-add-ink)]", label: "Done" },
};

/** Yellow while the agent works, red when it waits on the user, green when it is done. */
export function StatusDot({ status }: { status: Status }) {
  const { colour, label } = DOT[status];
  return (
    <span role="img" aria-label={label} title={label} className="relative flex size-2">
      {status !== "done" && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", colour)} />}
      <span className={cn("relative size-2 rounded-full", colour)} />
    </span>
  );
}

let audio: AudioContext | null = null;
/** Resumes the chime's audio: called on the user's first press. */
export const unlockAudio = () => void (audio ??= new AudioContext()).resume();

/** Two soft notes, rising when done and falling when the agent needs the user. */
export function chime(status: Status) {
  try {
    audio ??= new AudioContext();
    const notes = status === "done" ? [660, 880] : [700, 520];
    notes.forEach((hz, i) => {
      const at = audio!.currentTime + i * 0.14;
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      osc.connect(gain).connect(audio!.destination);
      osc.start(at);
      osc.stop(at + 0.32);
    });
  } catch {
    /* no audio: the dot still says it */
  }
}
