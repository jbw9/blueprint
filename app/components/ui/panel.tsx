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
    <header className="flex items-start gap-4 border-b border-border-gray bg-surface px-5 py-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {note ? (
          <p className="mt-1 text-[13px] leading-snug text-muted-slate">{note}</p>
        ) : null}
      </div>
      {right}
    </header>
  );
}

/** The ✕ every panel closes with, for PanelHead's `right`. */
export function PanelClose({ onClick, type = "button" }: { onClick?: () => void; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      aria-label="Close"
      title="Close (Esc)"
      className="-mr-1.5 -mt-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center text-muted-slate hover:bg-surface-container hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
        <path d="m4.5 4.5 7 7m0-7-7 7" />
      </svg>
    </button>
  );
}
