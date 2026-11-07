"use client";

import { AgentIcon, TerminalIcon } from "@/components/agent/agents";
import { inFront } from "@/components/agent/strip";
import type { Tab } from "@/components/agent/workspace-tab";

/** The glyph before a tab's name: what kind of tab it is, or the agent in front of its shell. */
export function iconOf(t: Tab) {
  const front = inFront(t);
  return t.kind === "preview" ? (
    <GlobeIcon />
  ) : t.kind === "plan" ? (
    <PlanIcon />
  ) : t.kind === "file" ? (
    <FileIcon />
  ) : t.kind === "blank" ? null : t.kind !== "shell" ? (
    <PhoneIcon />
  ) : front ? (
    <AgentIcon id={front.id} />
  ) : (
    <TerminalIcon />
  );
}

/** A page: the Preview tab. Drawn like the terminal glyph. */
export function GlobeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden className="size-3 shrink-0">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.7 1.8 2.5 3.8 2.5 6S9.7 12.2 8 14C6.3 12.2 5.5 10.2 5.5 8S6.3 3.8 8 2Z" />
    </svg>
  );
}

/** A page with a check: a plan's tab. */
export function PlanIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-3 shrink-0">
      <path d="M4 1.5h5.5L12 4v10.5H4z" />
      <path d="m6.2 9.2 1.4 1.4 2.4-2.8" />
    </svg>
  );
}

/** A page with a folded corner: a file's tab. */
export function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-3 shrink-0">
      <path d="M4 1.5h5.5L12 4v10.5H4z" />
      <path d="M9.5 1.5V4H12" />
    </svg>
  );
}

/** A phone: the iOS and Android tabs. */
export function PhoneIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden className="size-3 shrink-0">
      <rect x="4" y="1.5" width="8" height="13" rx="2" />
      <path d="M7 12h2" />
    </svg>
  );
}
