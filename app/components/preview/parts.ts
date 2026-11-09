import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Target } from "@/lib/agent/context";
import type { Size } from "@/components/preview/viewport";

/** Claude waiting on the user to sign in, and where they chose to keep it. */
export type Signing = { site: string; project: boolean };

export interface Line {
  level: string;
  text: string;
}

/** A message from the agent in the page (src-tauri/src/agent.js). */
export type Said =
  | { type: "location"; url: string; title?: string }
  | { type: "console"; level: string; text: string }
  | { type: "open"; url: string }
  | { type: "reply"; id: number; ok: boolean; value: unknown }
  | { type: "loaded" }
  /** The proxy's waiting page: the server behind it did not answer (src-tauri/src/preview.rs). */
  | { type: "down" }
  /** The user picked one or more things to hand to Claude, the last at (x, y) in the page. */
  | { type: "pick"; x: number; y: number; targets: Target[] }
  | { type: "unpick" }
  /** The page's select mode went on or off (agent.js). */
  | { type: "selecting"; on: boolean }
  /** The page took the keyboard, or was given a browser's key off a Mac. */
  | { type: "focus" }
  | { type: "key"; key: string };

/** What a page has said since it was last asked (agent.js). */
export const DRAIN = "window.__blueprint ? window.__blueprint.drain() : []";

type Set<T> = Dispatch<SetStateAction<T>>;

/**
 * A Preview's refs, setters and own calls (components/preview/preview.tsx),
 * for its code kept outside it: navigation.ts, tools.ts, messages.ts and webview.ts. The
 * Preview gathers them when a call is made, never in render, as refs are
 * only read outside it.
 */
export type Parts = {
  id: number;
  root: string;
  stage: RefObject<HTMLDivElement | null>;
  sheet: RefObject<HTMLDivElement | null>;
  sizeBadge: RefObject<HTMLDivElement | null>;
  proxy: RefObject<{ id: number; port: number } | null>;
  browser: RefObject<string | null>;
  ownStore: RefObject<boolean>;
  signingNow: RefObject<Signing | null>;
  signedIn: RefObject<((done: boolean) => void) | null>;
  here: RefObject<string>;
  server: RefObject<string | undefined>;
  log: RefObject<Line[]>;
  dialogs: RefObject<string[]>;
  pending: RefObject<Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>>;
  everLoaded: RefObject<boolean>;
  missed: RefObject<string | null>;
  trail: RefObject<{ list: string[]; at: number; stepping: boolean }>;
  view: RefObject<{ vw: number; vh: number; scale: number }>;
  hear: RefObject<(m: Said) => void>;
  replace: RefObject<() => void>;
  setPointed: Set<string | undefined>;
  setShown: Set<string>;
  setBadge: Set<boolean>;
  setWeb: Set<string | null>;
  setSigning: Set<Signing | null>;
  display: (url: string) => string;
  go: (url: string) => void;
  fail: (e: unknown) => void;
  loaded: () => void;
  nextLoad: () => Promise<void>;
  navigate: (raw: string) => Promise<string>;
  agent: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  resize: (next: Size | null) => void;
};
