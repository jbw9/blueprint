"use client";

import { useCallback, useEffect, useState } from "react";
import { DIALOG, Field, INPUT, Overlay, Segmented } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PanelClose, PanelHead } from "@/components/ui/panel";
import { cn } from "@/lib/client/utils";

/**
 * Report a bug or send feedback, as a dialog: what happened, up to three pictures (picked, pasted or
 * dropped), and an email to be answered at if the reader wants one. Sent through the app's server
 * (app/api/feedback/route.ts) to the admin dashboard. Below the form, what this machine has sent
 * before, each with the status it has on the dashboard.
 */

const OPEN = "blueprint:feedback";
export const openFeedback = () => window.dispatchEvent(new Event(OPEN));

type Kind = "bug" | "feedback";
interface Report {
  id: number;
  at: string;
  kind: Kind;
  message: string;
  images: number;
  status: string | null;
  updated_at: string | null;
}

const KINDS: { value: Kind; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "feedback", label: "Feedback" },
];

const MAX_IMAGES = 3;
// Under the backend's 380,000-character cap for one picture (scripts/api/admin.mjs).
const MAX_CHARS = 360_000;

/** A picture as a JPEG data URL small enough to send: scaled down and recompressed until it fits. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  let side = Math.min(1600, Math.max(bitmap.width, bitmap.height));
  for (let quality = 0.85; ; ) {
    const scale = side / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d")!;
    // JPEG has no transparency: a transparent screenshot would otherwise turn black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length < MAX_CHARS || side < 300) return url;
    if (quality > 0.6) quality -= 0.15;
    else side = Math.round(side * 0.75);
  }
}

const STATUS_TONE: Record<string, string> = {
  pending: "border-amber-line bg-amber-surface text-amber-ink",
  "in progress": "border-accent-line bg-accent-surface text-accent",
  resolved: "border-diff-add-line bg-diff-add-surface text-diff-add-ink",
  closed: "border-border-gray text-muted-slate",
};

function Status({ status }: { status: string | null }) {
  return (
    <span className={cn("shrink-0 border px-1.5 font-mono text-[10.5px] uppercase tracking-[0.04em]", STATUS_TONE[status ?? ""] ?? "border-border-gray text-faint")}>
      {status ?? "unknown"}
    </span>
  );
}

export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [dragging, setDragging] = useState(false);

  const load = useCallback(() => {
    fetch("/api/feedback")
      .then((r) => r.json())
      .then((j: { reports?: Report[] }) => setReports(j.reports ?? []))
      .catch(() => setReports([]));
  }, []);

  useEffect(() => {
    const on = () => {
      setOpen(true);
      setSent(false);
      setError(null);
      load();
    };
    window.addEventListener(OPEN, on);
    return () => window.removeEventListener(OPEN, on);
  }, [load]);

  const add = useCallback(async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith("image/"));
    if (!pics.length) return;
    setError(null);
    try {
      const urls = await Promise.all(pics.map(shrink));
      setImages((now) => {
        const next = [...now, ...urls];
        if (next.length > MAX_IMAGES) setError(`Up to ${MAX_IMAGES} pictures.`);
        return next.slice(0, MAX_IMAGES);
      });
    } catch {
      setError("Couldn't read that picture.");
    }
  }, []);

  // A screenshot pasted anywhere in the dialog joins the pictures.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.some((f) => f.type.startsWith("image/"))) return;
      e.preventDefault();
      void add(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, add]);

  if (!open) return null;
  const close = () => setOpen(false);

  const send = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, message, email, images }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error ?? "Couldn't send it just now. Try again.");
      setMessage("");
      setImages([]);
      setSent(true);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send it just now. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Overlay onClose={close}>
      <form
        role="dialog"
        aria-label="Report a bug or send feedback"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        onDragOver={(e) => {
          if (![...e.dataTransfer.items].some((i) => i.kind === "file")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void add([...e.dataTransfer.files]);
        }}
        className={cn(DIALOG, "max-w-[520px]", dragging && "outline-2 -outline-offset-2 outline-accent")}
      >
        <PanelHead title="Report a bug or send feedback" note="It goes straight to the people who make Blueprint." right={<PanelClose onClick={close} />} />
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-5 py-5">
          <Field group label="What is it" hint="Something broken, or something you'd like.">
            <Segmented label="What is it" value={kind} options={KINDS} onChange={setKind} />
          </Field>
          <Field label={kind === "bug" ? "What happened" : "Your feedback"} hint={kind === "bug" ? "What you did, what you expected, and what happened instead." : "What would make Blueprint better for you."}>
            <textarea
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={5}
              maxLength={8000}
              className={cn(INPUT, "resize-y font-sans text-[13px]")}
            />
          </Field>
          <Field group label="Pictures" hint={`Optional, up to ${MAX_IMAGES}. Pick, paste or drop screenshots.`}>
            <div className="flex flex-wrap items-center gap-2">
              {images.map((src, i) => (
                <div key={i} className="group relative h-16 w-24 border border-border-gray bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimize */}
                  <img src={src} alt={`Picture ${i + 1}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label={`Remove picture ${i + 1}`}
                    onClick={() => setImages((now) => now.filter((_, k) => k !== i))}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 cursor-pointer items-center justify-center bg-card/90 text-[13px] leading-none text-ink hover:bg-accent hover:text-on-accent"
                  >
                    ×
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES ? (
                <label className="inline-flex h-7 cursor-pointer items-center border border-border-strong bg-card px-2.5 font-mono text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink hover:border-accent hover:bg-accent hover:text-on-accent">
                  Add picture
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      void add([...(e.target.files ?? [])]);
                      e.target.value = "";
                    }}
                  />
                </label>
              ) : null}
            </div>
          </Field>
          <Field label="Email" hint="Optional. Leave one if you'd like us to write back.">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={INPUT} />
          </Field>
          <p className="-mt-2 text-[12px] text-muted-slate">Sent with your app version and system{" "}— never your code.</p>
          <div className="flex items-center gap-3">
            <Button variant="primary" type="submit" disabled={!message.trim() || sending}>
              {sending ? "Sending…" : "Send"}
            </Button>
            {error ? <span className="text-[12.5px] text-clay-ink">{error}</span> : sent ? <span className="text-[12.5px] text-muted-slate">Sent. Thank you — it shows below as pending.</span> : null}
          </div>

          {reports?.length ? (
            <section className="flex flex-col gap-2 border-t border-border-gray pt-4">
              <h3 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">Your reports</h3>
              <ul className="flex flex-col">
                {reports.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 border-t border-border-gray py-2 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[12.5px] text-ink">{r.message}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-faint">
                        {r.kind === "bug" ? "Bug" : "Feedback"} · {new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        {r.images ? ` · ${r.images} picture${r.images === 1 ? "" : "s"}` : ""}
                        {r.updated_at ? ` · updated ${new Date(r.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                      </p>
                    </div>
                    <Status status={r.status} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </form>
    </Overlay>
  );
}
