import { useSyncExternalStore } from "react";
import { signal } from "@/lib/client/signal";

/** Shows or hides the workspace (components/agent/workspace.tsx), from anywhere in the app. */
export const TOGGLE = "blueprint:workspace";
export const toggleWorkspace = () => window.dispatchEvent(new Event(TOGGLE));

/** Brings the blueprint in front of any tab docked in the main view, for what opens on it (the timeline). */
export const SHOW_BLUEPRINT = "blueprint:show-blueprint";
export const showBlueprint = () => window.dispatchEvent(new Event(SHOW_BLUEPRINT));

let workspaceOpen = false;
const workspaceSignal = signal();
export const setWorkspaceOpen = (open: boolean) => {
  if (open === workspaceOpen) return;
  workspaceOpen = open;
  workspaceSignal.emit();
};
export const useWorkspaceOpen = () => useSyncExternalStore(workspaceSignal.subscribe, () => workspaceOpen, () => false);
