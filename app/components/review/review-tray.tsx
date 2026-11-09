"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBlueprint } from "@/components/blueprint/blueprint-context";
import { addNote, clearSent, dropNote, editNote, reviewFor, sendNow, sendReview, stopEditing, useEditing, useNotes, type Editing, type Note } from "@/lib/agent/notes";
import { keys } from "@/components/ui/button";
import { PRIMARY, QUIET } from "@/components/ui/dialog";
import { cn } from "@/lib/client/utils";
import { useDesktop, useMac } from "@/lib/client/platform";
import { GAP, STATUSBAR } from "@/lib/client/layout";

/**
 * The review: notes left on the blueprint, in a diff or in the code (lib/agent/notes.ts),
 * gathered in a tray in the corner until they go to Claude as one turn. Also
 * the editor a note is written in, opened at the pointer from any right-click
 * menu. Above the history panel, so a hunk can be commented on while it is in
 * view. In the desktop app only, where Claude runs.
 */

/** A field to write a note in. */
const FIELD = "w-full border border-border-gray bg-card px-2 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent";

export function ReviewTray() {
  const { name } = useBlueprint();
  const desktop = useDesktop();
  useEffect(() => reviewFor(name), [name]);
  const notes = useNotes();
  const editing = useEditing();
  if (!desktop) return null;
  return (
    <>
      {editing ? <NoteEditor key={editing.anchor.key} e={editing} /> : null}
      {notes.length ? <Tray notes={notes} /> : null}
    </>
  );
}

function Tray({ notes }: { notes: Note[] }) {
  const [extra, setExtra] = useState("");
  const [folded, setFolded] = useState(false);
  const drafts = notes.filter((n) => n.status === "draft");
  const sending = notes.some((n) => n.status === "sending");
  const sent = notes.filter((n) => n.status === "sent");
  return (
    <section
      aria-label="Review"
      data-chrome
      style={{ bottom: STATUSBAR + GAP, left: GAP }}
      className="fixed z-[60] flex max-h-[min(460px,60vh)] w-[340px] flex-col overflow-hidden border border-border-gray bg-card shadow-lift"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border-gray px-3 py-2">
        <button type="button" onClick={() => setFolded((f) => !f)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left">
          <span className="text-[10px] text-faint">{folded ? "▸" : "▾"}</span>
          <span className="text-[13px] font-semibold text-ink">Review</span>
          <span className="text-[12px] text-muted-slate">
            {drafts.length ? `${drafts.length} note${drafts.length === 1 ? "" : "s"}` : sending ? "sending" : "sent"}
          </span>
        </button>
        {sent.length && !sending ? (
          <button type="button" onClick={clearSent} className="shrink-0 cursor-pointer text-[11.5px] text-faint hover:text-ink">
            clear sent
          </button>
        ) : null}
      </header>
      {folded ? null : (
        <>
          <ol className="min-h-0 flex-1 overflow-y-auto">
            {notes.map((n) => (
              <NoteRow key={n.id} n={n} />
            ))}
          </ol>
          {drafts.length || sending ? (
            <div className="flex shrink-0 flex-col gap-2 border-t border-border-gray p-2.5">
              {sending ? (
                <div className="flex items-center gap-2 text-[12px] text-muted-slate">
                  <span className="min-w-0 flex-1">Waiting for Claude to finish its turn…</span>
                  <button type="button" onClick={sendNow} className="shrink-0 cursor-pointer text-accent hover:underline">
                    Send now
                  </button>
                </div>
              ) : (
                <>
                  <textarea
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void sendReview(extra).then(() => setExtra(""));
                      }
                    }}
                    rows={2}
                    placeholder="Anything else for Claude… (optional)"
                    className={cn(FIELD, "resize-none")}
                  />
                  <button
                    type="button"
                    onClick={() => void sendReview(extra).then(() => setExtra(""))}
                    title="Sends every note to Claude as one turn, once it has finished the one it is on"
                    className={cn(PRIMARY, "justify-center")}
                  >
                    Send review to Claude
                  </button>
                </>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function NoteRow({ n }: { n: Note }) {
  const draft = n.status === "draft";
  const [open, setOpen] = useState(false);
  return (
    <li className={cn("group border-b border-border-gray px-3 py-2 last:border-b-0", !draft && "opacity-60")}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => draft && setOpen((o) => !o)}
          className={cn("min-w-0 flex-1 text-left", draft && "cursor-pointer")}
          title={draft ? "Edit this note" : undefined}
        >
          <p className="truncate text-[11.5px] text-faint">{n.anchor.title}</p>
          {n.note.trim() ? <p className="whitespace-pre-line text-[12.5px] leading-snug text-ink">{n.note}</p> : null}
        </button>
        <span className="shrink-0 text-[11px] text-faint">{n.status === "sending" ? "◷" : n.status === "sent" ? "✓" : null}</span>
        {draft ? (
          <button
            type="button"
            aria-label={`Remove the note on ${n.anchor.title}`}
            onClick={() => dropNote(n.id)}
            className="shrink-0 cursor-pointer text-faint opacity-0 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
          >
            ×
          </button>
        ) : null}
      </div>
      {open && draft ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <textarea
            value={n.note}
            onChange={(e) => editNote(n.id, { note: e.target.value })}
            rows={2}
            placeholder="Your comment"
            className={cn(FIELD, "resize-none py-1")}
          />
        </div>
      ) : null}
    </li>
  );
}

/** Writing one comment, at the pointer. ⌘/Ctrl+Enter adds it, Escape lets it go. */
function NoteEditor({ e }: { e: Editing }) {
  const [note, setNote] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLTextAreaElement>(null);
  const [at, setAt] = useState({ x: e.x, y: e.y });
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (box)
      setAt({
        x: Math.max(4, Math.min(e.x, window.innerWidth - box.width - 4)),
        y: Math.max(4, Math.min(e.y, window.innerHeight - box.height - 4)),
      });
    first.current?.focus();
  }, [e.x, e.y]);

  const ready = note.trim() !== "";
  const add = () => {
    if (!ready) return;
    addNote({ anchor: e.anchor, note });
  };
  const onKey = (k: React.KeyboardEvent) => {
    if (k.key === "Escape") {
      k.stopPropagation();
      stopEditing();
    } else if (k.key === "Enter" && (k.metaKey || k.ctrlKey)) {
      k.preventDefault();
      add();
    }
  };
  const field = cn(FIELD, "resize-y");
  const mac = useMac();

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Comment"
      data-chrome
      data-note-editor
      onKeyDown={onKey}
      style={{ left: at.x, top: at.y }}
      className="fixed z-[70] flex w-[340px] flex-col gap-2 border border-border-gray bg-card p-3 shadow-lift"
    >
      <p className="truncate text-[11.5px] text-faint">
        Comment on <span className="text-ink">{e.anchor.title}</span>
      </p>
      <textarea
        ref={first}
        value={note}
        onChange={(x) => setNote(x.target.value)}
        rows={3}
        placeholder="What should change here?"
        className={field}
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-faint">{keys(mac, mac ? "↵" : "Enter")} to add</span>
        <button type="button" onClick={stopEditing} className={QUIET}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={add}
          className={PRIMARY}
        >
          Add to review
        </button>
      </div>
    </div>
  );
}
