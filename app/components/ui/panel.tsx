import { cn } from "@/lib/client/utils";

/** The header every settings-style panel opens with. */
export function PanelHead({
  title,
  note,
  right,
}: {
  title: string;
  note?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex items-start gap-4 px-6 pb-3 pt-5">
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-[22px] font-normal leading-tight text-ink">
          {title}
        </h2>
        {note ? (
          <p className="mt-1 text-[13.5px] leading-snug text-muted-slate">{note}</p>
        ) : null}
      </div>
      {right}
    </header>
  );
}

/** The ✕ every panel closes with, for PanelHead's `right`. */
export function PanelClose({ onClick, type = "button", className }: { onClick?: () => void; type?: "button" | "submit"; className?: string }) {
  return (
    <button
      type={type}
      onClick={onClick}
      aria-label="Close"
      title="Close (Esc)"
      className={cn(
        "-mr-2 -mt-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded text-muted-slate transition-[background-color,color,transform] duration-150 hover:bg-surface-container hover:text-ink active:scale-90 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        className,
      )}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
        <path d="m4.5 4.5 7 7m0-7-7 7" />
      </svg>
    </button>
  );
}
