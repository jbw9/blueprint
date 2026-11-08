"use client";

import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { CLAUDE } from "@/components/agent/agents";
import type { Tab } from "@/components/agent/workspace-tab";

/** What the workspace (components/agent/workspace.tsx) keeps in localStorage between launches. */

export const OFFER_KEY = "blueprint.offer:";
/** The web app a project's Preview was last switched to, by its folder. */
export const SITE_KEY = "blueprint.site:";

export function storedSite(root: string): string | null {
  try {
    return localStorage.getItem(SITE_KEY + root);
  } catch {
    return null;
  }
}
/** The conversations Claude was having in the tabs, per project, so the app reopens them. */
export const SESSIONS_KEY = "blueprint.workspace.sessions";
/** The conversations of a closed project's Claudes, by its root, resumed when it is opened again. */
export const PARKED_KEY = "blueprint.workspace.parked:";

export function storedSessions(): { cwd: string; session: string }[] {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function offered(root: string) {
  try {
    return localStorage.getItem(OFFER_KEY + root) !== null;
  } catch {
    return false;
  }
}

/** Keeps the tabs' Claude conversations as they change, and reopens them once on launch. */
export function useSavedSessions(tabs: Tab[], add: (start: string | null, extra?: Partial<Tab>) => number) {
  // Before the restore below, so the empty first render never overwrites
  // what is about to be reopened.
  const restored = useRef(false);
  useEffect(() => {
    if (!restored.current) return;
    const open = tabs.flatMap((t) => (t.kind === "shell" && t.session ? [{ cwd: t.cwd, session: t.session }] : []));
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(open));
    } catch {
      /* not kept: the tabs still work */
    }
  }, [tabs]);
  useEffect(() => {
    if (restored.current || !isTauri()) return;
    restored.current = true;
    // Once, from storage the server render cannot read: initial state would not hydrate.
    for (const { cwd, session } of storedSessions()) add(CLAUDE.id, { cwd, session, resume: session });
  }, [add]);
}
