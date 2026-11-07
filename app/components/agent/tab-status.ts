"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { chime, unlockAudio } from "@/components/agent/status-dot";
import type { Tab } from "@/components/agent/workspace-tab";
import { tabStatus } from "@/lib/agent/context";
import { reportStatus, type Status } from "@/lib/client/open-projects";

/**
 * What the agents in the tabs are doing, told to everything outside the
 * workspace that shows it: the review queue, the open projects' dots, the
 * Dock's badge and the chime.
 */
export function useTabStatus(tabs: Tab[], desktop: boolean) {
  // A review waits for Claude to be idle before it is typed (lib/agent/context.ts sendBatch).
  useEffect(() => {
    for (const t of tabs) if (t.pty !== undefined) tabStatus(t.pty, t.live ? t.status : undefined);
    reportStatus(tabs);
  }, [tabs]);

  // The Dock icon's badge (src-tauri/src/lib.rs attention_count).
  const attention = tabs.filter((t) => t.live && (t.status === "done" || t.status === "waiting")).length;
  useEffect(() => {
    if (desktop) void invoke("attention_count", { n: attention }).catch(() => {});
  }, [desktop, attention]);

  // A chime when an agent finishes or needs the user, heard wherever they are
  // looking: the dot alone is easy to miss with the workspace closed.
  const was = useRef<Record<number, Status | undefined>>({});
  useEffect(() => {
    // WebKit lets a page sound only once the user has pressed something in it.
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, []);
  useEffect(() => {
    for (const t of tabs) {
      const before = was.current[t.key];
      if (t.status !== before && ((t.status === "done" && before === "working") || t.status === "waiting")) chime(t.status);
      was.current[t.key] = t.status;
    }
  }, [tabs]);
}
