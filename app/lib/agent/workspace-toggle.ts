/** Shows or hides the workspace (components/agent/workspace.tsx), from anywhere in the app. */
export const TOGGLE = "bluprint:workspace";
export const toggleWorkspace = () => window.dispatchEvent(new Event(TOGGLE));

/** Brings the bluprint in front of any tab docked in the main view, for what opens on it (the timeline). */
export const SHOW_BLUPRINT = "bluprint:show-bluprint";
export const showBluprint = () => window.dispatchEvent(new Event(SHOW_BLUPRINT));
