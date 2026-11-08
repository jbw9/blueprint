"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/editor";
import { FileFrame, TextStatus } from "@/components/ui/file-frame";
import { useBlueprint } from "@/components/blueprint/blueprint-context";
import type { Slice, WriteResult } from "@/lib/server/repo";
import { readSource, SOURCE_URL } from "@/lib/blueprint/source";
import { openTab } from "@/lib/client/tabs";

/**
 * A whole file, to read and edit as in an editor (D74), filling the view in
 * the shared FileFrame. It takes the level's place while `?file=` is in the URL, as a doc does (D66), and usually opens
 * in a tab of its own beside the level it came from — "Open the whole file"
 * on any code — so Back, Escape and closing the tab all return there.
 *
 * Text comes through `/api/source` and goes back through it, behind the same
 * containment and stale-read check as the code pane: a file that changed on
 * disk since it was opened is refused, never overwritten.
 */

const urlOf = (path: string[], file: string, line?: number) => {
  const q = new URLSearchParams();
  const now = new URLSearchParams(window.location.search);
  const blueprint = now.get("blueprint");
  if (blueprint) q.set("blueprint", blueprint);
  for (const id of path) q.append("at", id);
  q.set("file", file);
  if (line) q.set("line", String(line));
  return `?${q}`;
};

/** Opens a file over the level at `path`. */
export function openFile(path: string[], file: string, line?: number) {
  window.history.pushState(null, "", urlOf(path, file, line));
}

/** Opens a file in a new tab beside the one in front, over the level at `path`. */
export function openFileInTab(blueprint: string, path: string[], file: string, line?: number) {
  openTab(blueprint, path, file);
  openFile(path, file, line);
}

export function closeFile() {
  const q = new URLSearchParams(window.location.search);
  q.delete("file");
  q.delete("line");
  window.history.pushState(null, "", q.size ? `?${q}` : window.location.pathname);
}

/** The file open in the URL, if any. */
export function useOpenFile(): { file: string; line?: number } | null {
  const params = useSearchParams();
  const file = params.get("file");
  return file ? { file, line: Number(params.get("line")) || undefined } : null;
}

/**
 * A whole file of the repository as an editor holds it: read once, a draft
 * while it is typed in, and a save that writes the draft back. What is on disk
 * after a save is read again and is the only thing shown as the file.
 */
export function useRepoFile(file: string) {
  const { name: blueprint } = useBlueprint();
  const [slice, setSlice] = useState<Slice | null | "failed">(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState<WriteResult | null>(null);

  const read = useCallback(
    (signal?: AbortSignal) =>
      readSource({ blueprint, file, start: 1, end: Number.MAX_SAFE_INTEGER }, signal)
        .then((r) => ("slice" in r ? r.slice : ("failed" as const)))
        .catch(() => "failed" as const),
    [blueprint, file],
  );
  useEffect(() => {
    const ac = new AbortController();
    void read(ac.signal).then((s) => !ac.signal.aborted && setSlice(s));
    return () => ac.abort();
  }, [read]);

  const text = slice && slice !== "failed" ? slice.code : "";
  const dirty = draft !== null && draft !== text;

  async function save() {
    if (!dirty || !slice || slice === "failed" || SOURCE_URL) return;
    const res = await fetch("/api/source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // writeSlice drops one trailing newline from what it is sent; a whole
      // file may end in one of its own, so give it one to drop.
      body: JSON.stringify({ blueprint, file, start: 1, end: slice.total, code: `${draft}\n`, expected: text }),
    });
    const body = (await res.json()) as WriteResult;
    setSaved(body);
    if (body.ok) {
      setSlice(await read());
      setDraft(null);
    }
  }

  return {
    blueprint,
    /** Null while reading. */
    loaded: slice === null ? null : slice !== "failed",
    text,
    value: draft ?? text,
    dirty,
    readOnly: Boolean(SOURCE_URL),
    edit: (next: string) => (setDraft(next), setSaved(null)),
    save: () => void save(),
    /** For the status line: "saved", or why the write was refused. */
    saved: !saved
      ? null
      : saved.ok
        ? ("saved" as const)
        : saved.refused === "stale"
          ? "the file changed on disk since it was opened. Close it and open it again to get the current text."
          : (saved.refused ?? "refused"),
  };
}

/** A close for the frame's corner: back to the level the file or doc was opened over. */
export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClose} title="Back to the blueprint (Esc)" aria-label="Close">
      ✕
    </Button>
  );
}

export function FileView({ file, line }: { file: string; line?: number }) {
  const f = useRepoFile(file);
  const [caret, setCaret] = useState<{ line: number; col: number } | null>(null);
  return (
    <FileFrame
      path={file}
      dirty={f.dirty}
      onSave={f.save}
      tools={<CloseButton onClose={closeFile} />}
      className="absolute inset-0"
      status={
        f.loaded ? (
          <TextStatus file={file} caret={caret} lines={f.value.split("\n").length} dirty={f.dirty} saved={f.saved} readOnly={f.readOnly} />
        ) : null
      }
    >
      {f.loaded === null ? <p className="p-4 text-[12.5px] text-faint">Reading…</p> : null}
      {f.loaded === false ? <p className="p-4 text-[12.5px] text-clay-ink">Could not read this file from the repository.</p> : null}
      {f.loaded ? (
        <CodeEditor
          file={file}
          start={1}
          value={f.value}
          onChange={f.edit}
          onSave={f.save}
          onCursor={setCaret}
          readOnly={f.readOnly}
          lit={line}
          className="absolute inset-0"
        />
      ) : null}
    </FileFrame>
  );
}
