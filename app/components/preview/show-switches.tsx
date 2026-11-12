"use client";

import { useState } from "react";
import { Menu } from "@/components/ui/menu";
import { cn } from "@/lib/client/utils";

/** The toolbar's choice of what the tab shows: the page or its dev server's terminal, and which of the project's web apps. */
export function ShowSwitches({
  serverShown,
  onServer,
  sites,
  site,
  onSite,
}: {
  serverShown?: boolean;
  onServer?: (shown: boolean) => void;
  sites?: string[];
  site?: string;
  onSite?: (dir: string) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      {onServer ? (
        <div role="radiogroup" aria-label="Show" className="mr-1 flex shrink-0 items-center rounded-md bg-surface-container p-0.5">
          {[
            { label: "Page", on: !serverShown },
            { label: "Server", on: !!serverShown },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={o.on}
              onClick={() => onServer(o.label === "Server")}
              className={cn(
                "h-6 cursor-pointer rounded px-2.5 text-[11.5px] font-medium transition-[background-color,color,box-shadow] duration-150",
                o.on ? "bg-card text-ink shadow-[0_0_0_1px_var(--color-border-gray)]" : "text-muted-slate hover:text-ink",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
      {sites && sites.length > 1 ? (
        <>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={Boolean(menu)}
            title="Which web app to preview"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu(menu ? null : { x: r.left, y: r.bottom + 4 });
            }}
            className={cn(
              "mr-1 flex h-7 min-w-0 max-w-36 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-ink transition-colors duration-150 hover:bg-surface-container",
              menu && "bg-surface-container",
            )}
          >
            <span className="truncate">{site ?? sites[0]}</span>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-muted-slate">
              <path d="m1.5 3 2.5 2.5L6.5 3" />
            </svg>
          </button>
          {menu ? (
            <Menu
              x={menu.x}
              y={menu.y}
              title="Web app"
              onClose={() => setMenu(null)}
              items={sites.map((dir) => ({
                label: dir,
                icon: <span aria-hidden className={cn("size-1.5 rounded-full", dir === (site ?? sites[0]) ? "bg-accent" : "bg-transparent")} />,
                onClick: () => onSite?.(dir),
              }))}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
