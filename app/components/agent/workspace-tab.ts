import type { Plan } from "@/components/agent/plan";
import type { Platform } from "@/components/preview/device";
import type { Status } from "@/lib/client/open-projects";

/** A tab of the workspace (components/agent/workspace.tsx), in the window or the main view. */
export interface Tab {
  key: number;
  /** A terminal, the project running (its web app, or a phone), a plan, a file a terminal named, a file a commit changed, or nothing yet. */
  kind: "shell" | "preview" | "plan" | "file" | "diff" | "blank" | Platform;
  /** The agent it opened into, or null for a plain shell. */
  start: string | null;
  /** The agent last started in it, from the menu or the strip: what a busy shell is running. */
  ran: string | null;
  /** The shell's own name, `zsh` for `/usr/bin/zsh`. */
  title: string;
  /** The checkout it was opened in: which project's tab it is. */
  cwd: string;
  /** The pty behind it, once started. */
  pty?: number;
  /** An agent is running in it through the app's launcher, able to take picks. */
  live: boolean;
  /** Which agent that is: `claude`, `codex`, `opencode` or `pi`. */
  agent?: string;
  /** Some other program is in front of the shell. */
  busy: boolean;
  /** Whether Claude Code was found for it; unknown while it starts. */
  found?: boolean;
  /** A command the app typed into it when it opened: the dev server, a setup, a build. */
  run?: string;
  /** What it is called instead of its shell's name, when the app opened it for something. */
  label?: string;
  /** What the user renamed it to, over any name the app gives it. */
  name?: string;
  /** It runs the dev server: its output is watched for the server's address,
   * and it is drawn in the project's Preview tab rather than in a tab of its own. */
  dev?: boolean;
  /** The dev server's: the folder of the web app it serves. */
  site?: string;
  /** Moved out of the window, into the main view in front of the blueprint. */
  main?: boolean;
  /** What the agent in front is doing, for the dot on the tab. */
  status?: Status;
  /** A plan's tab: the plan, and the tab of the Claude that wrote it. */
  plan?: Plan;
  of?: number;
  /** A file's tab: its absolute path, and the line it was opened at. */
  file?: string;
  line?: number;
  /** The conversation Claude is having in it, to reopen it into after a restart. */
  session?: string;
  /** Reopened after a restart: the conversation its Claude picks up again. */
  resume?: string;
  /** Its Claude was started on Blueprint credit (lib/client/credit.ts). */
  credit?: boolean;
  /** Its Claude was refused a call because the credit is used up. */
  outOfCredit?: boolean;
  /** The reader chose their own Claude Code in Settings, so this credit tab asks to move. */
  offerOwn?: boolean;
}

/** How a project is run, from its files (src-tauri/src/devices.rs). */
export interface Project {
  /** Its web apps, the one to open first leading: the folder each is in, and how it starts. */
  web: { dir: string; run: string }[];
  android: boolean;
  ios: boolean;
}
