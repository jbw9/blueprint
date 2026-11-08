"use client";

/** The viewport before there is a page to show: why not, and what can be done about it. */
export function Placeholder({
  blank,
  error,
  waiting,
  asking,
  onAnswer,
  onServer,
  onStart,
}: {
  blank?: boolean;
  error: string | null;
  waiting?: string;
  asking?: string;
  onAnswer?: (yes: boolean) => void;
  onServer?: (shown: boolean) => void;
  onStart?: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-8 text-center">
      {error ? (
        <p className="font-mono text-[11.5px] text-clay-ink">{error}</p>
      ) : waiting && asking ? (
        <>
          <p className="text-[13px] text-ink">The dev server is asking</p>
          <p className="max-w-full whitespace-pre-wrap font-mono text-[11.5px] text-muted-slate">{asking}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onAnswer?.(true)}
              className="cursor-pointer bg-accent px-3 py-1 text-[12px] text-on-accent hover:opacity-90"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => onAnswer?.(false)}
              className="cursor-pointer px-3 py-1 text-[12px] text-muted-slate ring-1 ring-current hover:text-ink"
            >
              No
            </button>
          </div>
        </>
      ) : waiting ? (
        <>
          <p className="text-[13px] text-ink">Starting the dev server…</p>
          <p className="max-w-full truncate font-mono text-[11.5px] text-faint">{waiting}</p>
          <p className="text-[12px] text-muted-slate">The page opens here as soon as it prints its address.</p>
          {onServer ? (
            <button type="button" onClick={() => onServer(true)} className="mt-1 cursor-pointer text-[12px] text-accent hover:underline">
              Show its terminal
            </button>
          ) : null}
        </>
      ) : blank ? (
        <>
          <p className="text-[13px] text-ink">New tab</p>
          <p className="text-[12px] text-muted-slate">Type an address above, or anything to search the web.</p>
        </>
      ) : (
        <>
          <p className="text-[13px] text-ink">Nothing to preview yet</p>
          {onStart ? (
            <button type="button" onClick={onStart} className="mb-1 cursor-pointer bg-accent px-3 py-1 text-[12px] text-on-accent hover:opacity-90">
              Start the dev server
            </button>
          ) : null}
          <p className="text-[12px] text-muted-slate">Type an address above, like localhost:3000, or anything to search the web.</p>
          <p className="text-[12px] text-muted-slate">Claude browses here too: ask it to look something up, and the page opens in this tab.</p>
        </>
      )}
    </div>
  );
}
