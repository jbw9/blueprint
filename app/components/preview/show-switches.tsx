"use client";

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
  return (
    <>
      {onServer ? (
        <div role="radiogroup" aria-label="Show" className="mr-1 flex shrink-0 items-center bg-surface-container p-0.5">
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
                "h-5 cursor-pointer px-2 text-[11.5px]",
                o.on ? "bg-card text-ink shadow-[0_0_0_1px_var(--color-border-gray)]" : "text-muted-slate hover:text-ink",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
      {sites ? (
        <div role="radiogroup" aria-label="Web app" className="mr-1 flex min-w-0 shrink items-center overflow-hidden bg-surface-container p-0.5">
          {sites.map((dir) => (
            <button
              key={dir}
              type="button"
              role="radio"
              aria-checked={dir === site}
              title={`Preview ${dir}`}
              onClick={() => onSite?.(dir)}
              className={cn(
                "h-5 max-w-28 shrink cursor-pointer truncate px-2 text-[11.5px]",
                dir === site ? "bg-card text-ink shadow-[0_0_0_1px_var(--color-border-gray)]" : "text-muted-slate hover:text-ink",
              )}
            >
              {dir}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
