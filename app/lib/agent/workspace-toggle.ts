/** Shows or hides the workspace (components/agent/workspace.tsx), from anywhere in the app. */
export const TOGGLE = "bluprint:workspace";
export const toggleWorkspace = () => window.dispatchEvent(new Event(TOGGLE));
