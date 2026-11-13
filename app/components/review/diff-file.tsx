"use client";

import { useState, useSyncExternalStore } from "react";
import { FilePane } from "@/components/review/commit-detail";
import type { View } from "@/components/review/diff-view";
import type { FileChange } from "@/lib/server/diff";
import { cn } from "@/lib/client/utils";

/**
 * The file picked in the history panel (components/review/diff-panel.tsx), read
 * in a tab of the workspace window (components/agent/workspace.tsx) rather than
 * inside the panel, so the panel stays a small popup and the lines get the room.
 * The workspace sits outside the diff's provider, hence a store both can reach.
 *
 * Picking a file closes the panel; the tab stays until the reader closes it.
 */
export interface DiffFile {
  files: FileChange[];
  path: string;
  open: boolean;
}

let now: DiffFile | null = null;
const heard = new Set<() => void>();

export function setDiffFile(next: DiffFile | null | ((was: DiffFile | null) => DiffFile | null)) {
  now = typeof next === "function" ? next(now) : next;
  for (const f of heard) f();
}

export const useDiffFile = () =>
  useSyncExternalStore(
    (f) => (heard.add(f), () => void heard.delete(f)),
    () => now,
    () => null,
  );

const VIEW_KEY = "blueprint.diff.view";

export function DiffTab({ visible, inset }: { visible: boolean; inset?: string }) {
  const d = useDiffFile();
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "split" ? "split" : "inline";
    } catch {
      return "inline";
    }
  });
  const file = d?.files.find((f) => f.path === d.path);
  if (!d || !file) return null;
  const at = d.files.indexOf(file);
  const keep = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  return (
    <div className={cn("absolute inset-0 flex flex-col bg-card", !visible && "hidden")} style={inset ? { right: inset } : undefined}>
      <FilePane
        file={file}
        view={view}
        at={at}
        of={d.files.length}
        onStep={(k) => setDiffFile({ ...d, path: d.files[at + k]?.path ?? d.path })}
        layout={
          <div role="group" aria-label="Diff layout" className="flex shrink-0 rounded-md border border-border-gray p-0.5">
            {(["inline", "split"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => keep(v)}
                className={cn("cursor-pointer rounded px-2 py-0.5 text-[11.5px]", view === v ? "bg-accent text-on-accent" : "text-muted-slate hover:text-ink")}
              >
                {v === "split" ? "Side by side" : "Inline"}
              </button>
            ))}
          </div>
        }
      />
    </div>
  );
}
