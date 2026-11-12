"use client";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { openSettings } from "@/lib/client/settings";
import { openFeedback } from "@/components/chrome/feedback";
import { openPalette } from "@/components/chrome/palette";
import { Kbd, keys } from "@/components/ui/button";
import { openDiff, useDiff } from "@/components/review/diff";
import { toggleWorkspace } from "@/lib/agent/workspace-toggle";
import { cn } from "@/lib/client/utils";
import { useDesktop } from "@/lib/client/platform";
import { toggleRail, useRailExpanded, useRailWidth } from "@/lib/client/rail";
import { setTabSlot } from "@/components/chrome/tab-slot";
import { FeedbackGlyph, GearGlyph, RailGlyph } from "@/components/chrome/icons";

/**
 * The window's own title bar. The native one is off (`decorations: false` in
 * tauri.conf.json), so this draws the tools and the window buttons in the
 * page's palette rather than the desktop's. The projects open are the rail's
 * (components/chrome/project-rail.tsx). The blueprint below has no header of its
 * own in the desktop app.
 *
 * Everything marked `data-tauri-drag-region` moves the window, and a double
 * click on it maximizes, as a native bar does. Buttons sit outside those
 * regions so a click on one is never read as the start of a drag. Outside the
 * desktop app (plain `next dev` in a browser) there is no window to drive, so
 * nothing is drawn.
 *
 * On a Mac the window keeps its own traffic lights (tauri.macos.conf.json
 * overlays them on this bar), so the bar leaves room for them on the left and
 * draws no buttons of its own on the right.
 */


/**
 * `bare` is the window with no blueprint open (components/chrome/welcome.tsx): the frame,
 * settings and the window buttons, so it can still be moved and closed. The
 * page itself offers Open Folder there, as VS Code's welcome does.
 */
export function Titlebar({ bare }: { bare?: boolean }) {
  const desktop = useDesktop();
  const rail = useRailWidth();
  const wide = useRailExpanded();
  const [maximized, setMaximized] = useState(false);
  // Only read once `desktop` is true, which is never on the server.
  const mac = desktop && /Mac/.test(navigator.userAgent);

  useEffect(() => {
    if (!desktop) return;
    const win = getCurrentWindow();
    let live = true;
    const sync = () => win.isMaximized().then((m) => live && setMaximized(m));
    sync();
    const off = win.onResized(sync);
    return () => {
      live = false;
      off.then((f) => f());
    };
  }, [desktop]);

  if (!desktop) return null;
  const win = getCurrentWindow();
  // The rail's column: the fold button's cell, as wide as the rail under it. A
  // Mac's traffic lights are wider than the folded rail, so there it is theirs.
  const lead = bare ? undefined : mac ? Math.max(rail, 78) : rail;
  return (
    // Three columns: the rail's, the tabs, and the tools. The tools never give
    // up their buttons; when the window is too narrow the tabs scroll.
    <header
      data-tauri-drag-region
      data-chrome="bar"
      className="grid h-10 shrink-0 select-none grid-cols-[max-content_minmax(0,1fr)_max-content] items-end bg-surface-container-low shadow-[inset_0_-1px_0_var(--color-border-gray)]"
    >
      <div
        data-tauri-drag-region
        style={lead ? { width: lead } : undefined}
        className={cn("flex h-full min-w-0 items-center", bare ? (mac ? "pl-[78px]" : "pl-1.5") : "border-r border-border-gray px-2")}
      >
        {bare ? (
          <span data-tauri-drag-region className="px-2 font-mono text-[11.5px] font-semibold text-ink">
            Blueprint
          </span>
        ) : mac ? null : (
          <FoldButton wide={wide} />
        )}
      </div>
      {/* The blueprint's tabs are drawn here (components/chrome/tab-slot.tsx); the space after them moves the window. */}
      <div data-tauri-drag-region className="flex h-full min-w-0 items-end">
        {bare ? null : <div ref={setTabSlot} className="flex h-full min-w-0 items-end pl-1.5" />}
        <div data-tauri-drag-region className="h-full min-w-6 flex-1" />
      </div>
      <div data-tauri-drag-region className="flex h-full items-center justify-end">
        {bare ? null : <BlueprintTools mac={mac} />}
        {bare ? null : (
          <Control
            label="Claude Code & terminal"
            kbd={keys(mac, "`")}
            onClick={toggleWorkspace}
          >
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
            <path d="M4.5 6.5 6.5 8l-2 1.5M8.5 10h3" />
          </Control>
        )}
        {bare ? (
          <>
            <span aria-hidden className="mx-1 h-4 w-px bg-border-strong" />
            <Control label="Report a bug or send feedback" onClick={openFeedback}>
              <FeedbackGlyph />
            </Control>
            <Control label="Settings" onClick={openSettings}>
              <GearGlyph />
            </Control>
          </>
        ) : null}
        {mac ? null : (
          <>
            <span aria-hidden className="mx-1 h-4 w-px bg-border-strong" />
            <Control win label="Minimize" onClick={() => win.minimize()}>
              <path d="M4 8h8" />
            </Control>
            <Control win label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
              {maximized ? (
                <>
                  <rect x="3.5" y="5.5" width="7" height="7" rx="1" />
                  <path d="M6 5.5V4.5a1 1 0 0 1 1-1h4.5a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1h-1" />
            </>
          ) : (
            <rect x="4" y="4" width="8" height="8" rx="1" />
          )}
        </Control>
        <Control win label="Close" onClick={() => win.close()} danger>
          <path d="m4.5 4.5 7 7m0-7-7 7" />
        </Control>
          </>
        )}
      </div>
    </header>
  );
}

/** The rail's fold button, at its top: folds the project list to icons, or opens it to names. */
export function FoldButton({ wide }: { wide: boolean }) {
  return (
    <button
      type="button"
      onClick={toggleRail}
      aria-label={wide ? "Fold the project list to icons" : "Show project names"}
      aria-expanded={wide}
      title={wide ? "Fold to icons" : "Show names"}
      className={cn(
        "flex h-7 cursor-pointer items-center gap-2.5 text-[12px] text-muted-slate transition-colors hover:bg-surface-container hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        wide ? "w-full px-2" : "w-full justify-center",
      )}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <RailGlyph />
      </svg>
      {wide ? <span>Fold</span> : null}
    </button>
  );
}

/** The tools that act on the open blueprint. */
function BlueprintTools({ mac }: { mac: boolean }) {
  const diff = useDiff();
  return (
    <>
      <Control
        label={diff?.diff || diff?.loading ? "Version control — showing changes on the blueprint. Open the history" : "Version control — the commit history, and what each changed"}
        onClick={openDiff}
        active={Boolean(diff?.diff || diff?.loading)}
      >
        {/* Lucide's git-branch, the glyph editors give source control. */}
        <g transform="scale(0.6667)" strokeWidth="1.875">
          <path d="M6 3v12" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </g>
      </Control>
      <Control label="Open a file, folder or symbol" kbd={keys(mac, "K")} onClick={() => openPalette("code")}>
        <path d="M4 1.5h5.5L12 4v10.5H4z" />
        <path d="M9.5 1.5V4H12" />
      </Control>
    </>
  );
}

function Control({
  label,
  onClick,
  danger,
  win,
  className,
  active,
  kbd,
  children,
}: {
  label: string;
  /** Shown at once on hover, with the label: the native title waits too long for a shortcut to be found. */
  kbd?: string;
  onClick: () => void;
  danger?: boolean;
  /** On: the mode this button turns on is showing. */
  active?: boolean;
  /** One of the window's own buttons: minimize, maximize, close. */
  win?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      aria-keyshortcuts={kbd}
      title={kbd ? undefined : label}
      className={cn(
        "group relative flex cursor-pointer items-center justify-center text-muted-slate transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        // Window buttons fill the bar's height, as native ones do; the tools
        // are small square targets, as in an editor's title bar.
        win ? "h-full w-12" : "mx-px h-8 w-8",
        danger ? "hover:bg-clay-ink hover:text-paper" : "hover:bg-surface-container hover:text-ink",
        active && "bg-accent text-on-accent hover:bg-accent-strong hover:text-on-accent",
        className,
      )}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
      {kbd ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-full right-0 z-50 mt-1 flex items-center gap-1.5 whitespace-nowrap border border-border-gray bg-surface px-2 py-1 font-sans text-[11.5px] text-ink opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-hover:delay-150"
        >
          {label} <Kbd>{kbd}</Kbd>
        </span>
      ) : null}
    </button>
  );
}
