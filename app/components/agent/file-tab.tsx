"use client";

import { invoke } from "@tauri-apps/api/core";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import { CodeEditor } from "@/components/ui/editor";
import { FileFrame, TextStatus, ViewSwitch, crumbsOf, useMarkdownView } from "@/components/ui/file-frame";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { PLUGINS, REHYPE } from "@/lib/client/markdown";
import { cn } from "@/lib/client/utils";

/**
 * A file a terminal named (components/agent/shell.tsx), open in the main view as an
 * editor tab in the shared FileFrame (components/ui/file-frame.tsx), a
 * Markdown one in the Markdown editor's views. Any file on disk, read and written through the
 * desktop app (src-tauri/src/files.rs) rather than the blueprint's `/api/source`,
 * since agents name files outside the project and Claude's pasted images.
 */

const MARKDOWN = /\.(md|mdx|markdown)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i;
/** Past this the editor's one-div-per-line drawing gets slow; such a file is named, not drawn. */
const TOO_BIG = 2_000_000;

type Read =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string; bytes: number }
  | { kind: "other"; why: string };

export function FileTab({ path, line, visible, inset }: { path: string; line?: number; visible: boolean; inset?: string }) {
  const [read, setRead] = useState<Read | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState<"saved" | string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [caret, setCaret] = useState<{ line: number; col: number } | null>(null);
  const [view, setView] = useMarkdownView();
  const md = MARKDOWN.test(path);
  const image = useLocalImages(path.slice(0, path.lastIndexOf("/")));

  const load = () =>
    invoke<ArrayBuffer>("file_read", { path }).then((buf): Read => {
      if (IMAGE.test(path)) {
        const type = path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "";
        return { kind: "image", url: URL.createObjectURL(new Blob([buf], type ? { type } : {})), bytes: buf.byteLength };
      }
      if (buf.byteLength > TOO_BIG) return { kind: "other", why: `Too large to open here (${(buf.byteLength / 1e6).toFixed(1)} MB).` };
      try {
        return { kind: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(buf) };
      } catch {
        return { kind: "other", why: "A binary file: nothing here to read as text." };
      }
    });

  useEffect(() => {
    let gone = false;
    let url: string | undefined;
    load()
      .catch((e): Read => ({ kind: "other", why: `Could not read it: ${String(e)}` }))
      .then((r) => {
        if (r.kind === "image") url = r.url;
        if (gone) return;
        setRead(r);
        setDraft(null);
      });
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const text = read?.kind === "text" ? read.text : "";
  const dirty = draft !== null && draft !== text;

  async function save() {
    if (!dirty || read?.kind !== "text") return;
    try {
      await invoke("file_write", { path, text: draft, expected: text });
      setRead({ kind: "text", text: draft! });
      setDraft(null);
      setSaved("saved");
    } catch (e) {
      setSaved(String(e) === "stale" ? "it changed on disk since it was opened. Reopen it to get the current text." : String(e));
    }
  }

  const name = crumbsOf(path).at(-1) ?? path;
  const value = draft ?? text;
  const edit = (next: string) => (setDraft(next), setSaved(null));

  return (
    <FileFrame
      path={path}
      dirty={dirty}
      onSave={() => void save()}
      active={visible}
      tools={read?.kind === "text" && md ? <ViewSwitch view={view} onView={setView} /> : null}
      className={cn("absolute inset-0", !visible && "hidden")}
      style={{ paddingRight: inset }}
      status={
        read?.kind === "text" ? (
          <TextStatus file={path} caret={caret} lines={value.split("\n").length} dirty={dirty} saved={saved} />
        ) : read?.kind === "image" ? (
          <>
            {size ? <span className="tnum">{size.w} × {size.h}</span> : null}
            <span className="tnum">{(read.bytes / 1024).toFixed(0)} KB</span>
          </>
        ) : null
      }
    >
      {read === null ? <p className="p-4 text-[12.5px] text-faint">Reading…</p> : null}
      {read?.kind === "other" ? <p className="p-4 text-[12.5px] text-muted-slate">{read.why}</p> : null}
      {read?.kind === "image" ? (
        <div className="absolute inset-0 flex items-center justify-center overflow-auto p-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob, not a page asset */}
          <img
            src={read.url}
            alt={name}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="max-h-full max-w-full object-contain shadow-[0_0_0_1px_var(--color-border-gray)]"
          />
        </div>
      ) : null}
      {read?.kind === "text" && md ? (
        <MarkdownEditor
          key={path}
          file={path}
          value={value}
          onChange={edit}
          onSave={() => void save()}
          onCursor={setCaret}
          lit={line}
          view={view}
          image={image}
          preview={(t) => <LocalMarkdown text={t} image={image} />}
          className="absolute inset-0"
        />
      ) : read?.kind === "text" ? (
        <CodeEditor
          key={path}
          file={path}
          start={1}
          value={value}
          onChange={edit}
          onSave={() => void save()}
          onCursor={setCaret}
          lit={line}
          className="absolute inset-0"
        />
      ) : null}
    </FileFrame>
  );
}

type Resolve = (src: string) => Promise<string> | string;

/** A path an image in the doc names, on disk, or null for one on the web. */
const localOf = (dir: string, src: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(src) ? null : src.startsWith("/") ? src : `${dir}/${decodeURIComponent(src.split(/[?#]/)[0])}`;

/** Images beside the file, read off disk once each and kept while the tab is open. */
function useLocalImages(dir: string): Resolve {
  const [cache] = useState(() => new Map<string, Promise<string>>());
  useEffect(
    () => () => {
      for (const p of cache.values()) void p.then((u) => URL.revokeObjectURL(u), () => {});
      cache.clear();
    },
    [cache],
  );
  return useCallback(
    (src) => {
      const local = localOf(dir, src);
      if (!local) return src;
      let p = cache.get(local);
      if (!p) {
        const type = local.toLowerCase().endsWith(".svg") ? { type: "image/svg+xml" } : {};
        p = invoke<ArrayBuffer>("file_read", { path: local }).then((buf) => URL.createObjectURL(new Blob([buf], type)));
        cache.set(local, p);
      }
      return p;
    },
    [dir, cache],
  );
}

const ImageSource = createContext<Resolve>((s) => s);

function LocalImg({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const resolve = useContext(ImageSource);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!src) return;
    let gone = false;
    void Promise.resolve(resolve(src)).then((u) => !gone && setUrl(u), () => {});
    return () => {
      gone = true;
    };
  }, [src, resolve]);
  // eslint-disable-next-line @next/next/no-img-element -- a local file's own image
  return <img src={url} alt={alt ?? ""} title={title} />;
}

const LOCAL: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt, title }) => <LocalImg src={typeof src === "string" ? src : undefined} alt={alt} title={title} />,
};

/** The page a Markdown file on disk draws, for the split view. */
function LocalMarkdown({ text, image }: { text: string; image: Resolve }) {
  return (
    <ImageSource.Provider value={image}>
      <Markdown remarkPlugins={PLUGINS} rehypePlugins={REHYPE} components={LOCAL}>
        {text}
      </Markdown>
    </ImageSource.Provider>
  );
}
