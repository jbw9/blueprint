"use client";

import { listen } from "@tauri-apps/api/event";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { StatusDot } from "@/components/agent/status-dot";
import { useBlueprint } from "@/components/blueprint/blueprint-context";
import { openProjects } from "@/components/projects/projects";
import { keys } from "@/components/ui/button";
import { arrived, closeProject, keepOnly, useOpenProjects } from "@/lib/client/open-projects";
import { useDesktop, useMac } from "@/lib/client/platform";
import { useRailExpanded, useRailWidth } from "@/lib/client/rail";
import { openSettings } from "@/lib/client/settings";
import { GearGlyph } from "@/components/chrome/icons";
import { FoldButton } from "@/components/chrome/titlebar";
import { cn } from "@/lib/client/utils";

/** Two letters that name a project at a glance: the first of each of its first two words, else its first two letters. */
export function initials(label: string) {
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const text = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? label).slice(0, 2);
  return text.toLowerCase();
}

/**
 * The projects open in the window, down its left edge: a square each with
 * its initials and the dot of the loudest Claude among its workspace tabs
 * (components/agent/workspace.tsx), the open one marked with an accent bar. The rail
 * opens to show their names (the fold button above it, kept between launches);
 * + opens another, imports one, or manages them. Switching keeps every
 * terminal running, and the workspace shows the tabs of the project switched
 * to. Cmd+1–9 (Ctrl+1–9 off a Mac) picks one. Middle click closes one. Where you
 * are inside the blueprint is the blueprint tabs' to say (components/chrome/tabs.tsx).
 */
export function ProjectRail() {
  const desktop = useDesktop();
  const mac = useMac();
  const width = useRailWidth();
  const wide = useRailExpanded();
  const { name, blueprints } = useBlueprint();
  const router = useRouter();
  const { open, last, status } = useOpenProjects();
  const shown = open.flatMap((id) => blueprints.filter((m) => m.id === id));
  const go = useCallback((id: string | null | undefined) => id && id !== name && router.push(`/?blueprint=${encodeURIComponent(id)}`), [name, router]);

  const was = useRef<string | null>(null);
  useEffect(() => {
    arrived(name, was.current);
    was.current = name;
  }, [name]);
  useEffect(() => keepOnly(blueprints.map((m) => m.id)), [blueprints]);

  // Off a Mac here; on one the menu bar takes the keys (src-tauri/src/lib.rs),
  // so they work from inside a Preview's page too.
  const ids = shown.map((m) => m.id).join("\n");
  useEffect(() => {
    const pick = (n: string) => go(n === "last" ? last : ids.split("\n")[Number(n) - 1]);
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      // Ctrl+Tab is the tabs' own (components/agent/workspace.tsx, components/chrome/tabs.tsx).
      const n = !e.shiftKey && /^Digit[1-9]$/.test(e.code) ? e.code.slice(5) : null;
      if (!n) return;
      e.preventDefault();
      e.stopPropagation();
      pick(n);
    };
    if (!mac) window.addEventListener("keydown", onKey, true);
    const fromMenu = mac ? listen<string>("blueprint:project", (e) => pick(e.payload)) : undefined;
    return () => {
      window.removeEventListener("keydown", onKey, true);
      void fromMenu?.then((f) => f());
    };
  }, [mac, go, last, ids]);

  const close = (id: string) => {
    if (id === name) {
      const at = shown.findIndex((m) => m.id === id);
      go((shown[at + 1] ?? shown[at - 1])?.id);
    }
    const root = shown.find((m) => m.id === id)?.root;
    closeProject(id, root && !shown.some((m) => m.id !== id && m.root === root) ? root : undefined);
  };

  if (!desktop) return null;
  return (
    <aside
      aria-label="Projects"
      data-chrome="bar"
      style={{ width }}
      className="flex shrink-0 select-none flex-col gap-2 overflow-y-auto overflow-x-hidden border-r border-border-gray bg-surface-container-low px-2 py-2 transition-[width] duration-[240ms] ease-[cubic-bezier(.2,.7,.2,1)]"
    >
      {mac ? <FoldButton wide={wide} /> : null}
      <div role="tablist" aria-label="Open projects" aria-orientation="vertical" className="flex flex-col gap-2">
        {shown.map((m, i) => {
          const here = m.id === name;
          const dot = m.root ? status[m.root] : undefined;
          return (
            <div
              key={m.id}
              role="tab"
              aria-selected={here}
              title={`${m.label}${i < 9 ? ` (${keys(mac, String(i + 1))})` : ""}`}
              onAuxClick={(e) => {
                if (e.button === 1 && shown.length > 1) {
                  e.preventDefault();
                  close(m.id);
                }
              }}
              className={cn(
                "group relative flex h-11 min-w-0 items-center rounded transition-[background-color,color] duration-150",
                here ? "bg-surface-container text-ink" : "text-on-surface-variant hover:bg-surface-container hover:text-ink",
              )}
            >
              <button
                type="button"
                onClick={() => go(m.id)}
                className={cn(
                  "flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded text-[13px] font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                  wide ? "px-2.5" : "justify-center",
                )}
              >
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded font-mono text-[11.5px] transition-colors duration-150", here ? "bg-accent text-on-accent" : "bg-border-gray text-ink")}>
                  {initials(m.label)}
                </span>
                {wide ? <span className="truncate">{m.label}</span> : null}
              </button>
              {dot ? (
                <span className={cn("flex", wide ? "mr-2 shrink-0" : "absolute bottom-1 right-1")}>
                  <StatusDot status={dot} />
                </span>
              ) : null}
              {wide && shown.length > 1 ? (
                <button
                  type="button"
                  onClick={() => close(m.id)}
                  aria-label={`Close ${m.label}`}
                  className="mr-2 flex size-4 shrink-0 cursor-pointer items-center justify-center text-faint opacity-0 hover:bg-border-gray hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <svg aria-hidden width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                    <path d="m1.5 1.5 5 5m0-5-5 5" />
                  </svg>
                </button>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => openProjects()}
          aria-label="Open another project"
          title="Open another project"
          className={cn(
            "flex h-11 cursor-pointer items-center gap-2.5 rounded text-[13px] font-medium text-muted-slate transition-[background-color,color,transform] duration-150 hover:bg-surface-container hover:text-ink active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-accent",
            wide ? "px-4" : "justify-center",
          )}
        >
          <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M5 1.5v7M1.5 5h7" />
          </svg>
          {wide ? <span>Open project</span> : null}
        </button>
      </div>
      <div className="mt-auto flex flex-col gap-1 border-t border-border-gray pt-2">
        <RailTool label="Settings" short="Settings" wide={wide} onClick={openSettings}>
          <GearGlyph />
        </RailTool>
      </div>
    </aside>
  );
}

/** A tool at the foot of the rail: its icon, and its name when the rail is open. */
function RailTool({ label, short, wide, onClick, children }: { label: string; short: string; wide: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-10 cursor-pointer items-center gap-2.5 rounded text-[13px] font-medium text-on-surface-variant transition-[background-color,color,transform] duration-150 hover:bg-surface-container hover:text-ink active:scale-[0.98] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        wide ? "px-4" : "justify-center",
      )}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
      {wide ? <span>{short}</span> : null}
    </button>
  );
}
