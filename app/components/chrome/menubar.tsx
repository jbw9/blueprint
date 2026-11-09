"use client";

import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { openFeedback } from "@/components/chrome/feedback";
import { openPalette } from "@/components/chrome/palette";
import { openFiles } from "@/components/blueprint/files";
import { newProject, openFolder, openProjects } from "@/components/projects/projects";
import { openDiff } from "@/components/review/diff";
import { openHistory } from "@/components/review/additions";
import { openClaude } from "@/lib/agent/context";
import { showBlueprint } from "@/lib/agent/workspace-toggle";
import { isDesktop } from "@/lib/client/platform";
import { openSettings } from "@/lib/client/settings";

/** What each of the Mac menu bar's `open-*` items does (src-tauri/src/lib.rs, `app_menu`). */
const ACTIONS: Record<string, () => unknown> = {
  settings: openSettings,
  "new-project": newProject,
  "open-folder": openFolder,
  projects: () => openProjects(),
  palette: () => openPalette("all"),
  "palette-code": () => openPalette("code"),
  "palette-actions": () => openPalette("actions"),
  blueprint: showBlueprint,
  diff: openDiff,
  history: openHistory,
  files: () => openFiles(),
  claude: openClaude,
  feedback: openFeedback,
};

export function MenuBar() {
  useEffect(() => {
    if (!isDesktop()) return;
    const off = listen<string>("blueprint:menu", (e) => ACTIONS[e.payload]?.());
    return () => void off.then((f) => f());
  }, []);
  return null;
}
