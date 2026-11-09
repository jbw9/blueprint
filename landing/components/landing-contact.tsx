"use client";

import { useState } from "react";
import s from "./landing.module.css";

// The admin dashboard's backend (app/scripts/api), as in landing-visit.tsx.
const API_URL = "https://rn24aj5jclm6ioyeqrlsxbztky0bfwgc.lambda-url.us-east-1.on.aws";

type Kind = "bug" | "feedback";
const MAX_IMAGES = 3;
// Under the backend's 380,000-character cap for one picture (app/scripts/api/admin.mjs).
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

/**
 * Report an issue or get in touch, at the foot of the page: it lands on the admin dashboard beside the
 * app's own reports, with the email to write back to.
 */
export function LandingContact() {
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const add = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith("image/"));
    if (!pics.length) return;
    setError(null);
    try {
      const urls = await Promise.all(pics.map(shrink));
      const next = [...images, ...urls];
      if (next.length > MAX_IMAGES) setError(`Up to ${MAX_IMAGES} pictures.`);
      setImages(next.slice(0, MAX_IMAGES));
    } catch {
      setError("Couldn't read that picture.");
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const r = await fetch(`${API_URL}/rpc/bp_feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ f: { source: "landing", kind, message, email, images } }),
      });
      const out = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null;
      if (!r.ok || !out?.ok) throw new Error(out?.error ?? out?.message ?? "Couldn't send it just now. Try again.");
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send it just now. Try again.");
      setState("idle");
    }
  };

  return (
    <section id="contact" className={s.section} aria-labelledby="contact-title">
      <h2 id="contact-title" className={s.reveal}>
        Contact.
      </h2>
      <p className={s.contactLede}>Found a bug, or have something to tell us? It comes straight to the people who make Blueprint, and we&rsquo;ll write back.</p>
      {state === "sent" ? (
        <div className={s.contact}>
          <p className={s.contactDone}>
            Thanks, it&rsquo;s with us. We&rsquo;ll write to <b>{email}</b>.
          </p>
          <button
            type="button"
            className={`${s.btn} ${s.ghost}`}
            onClick={() => {
              setMessage("");
              setImages([]);
              setState("idle");
            }}
          >
            Send another
          </button>
        </div>
      ) : (
        <form className={s.contact} onSubmit={send}>
          <div role="radiogroup" aria-label="What is it" className={s.contactKinds}>
            {(["bug", "feedback"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
                {k === "bug" ? "Report a bug" : "Feedback"}
              </button>
            ))}
          </div>
          <label>
            <span>Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </label>
          <label>
            <span>{kind === "bug" ? "What happened" : "Message"}</span>
            <textarea
              required
              rows={5}
              maxLength={8000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onPaste={(e) => {
                const files = [...e.clipboardData.files];
                if (!files.some((f) => f.type.startsWith("image/"))) return;
                e.preventDefault();
                void add(files);
              }}
              placeholder={kind === "bug" ? "What you did, what you expected, and what happened instead." : "What would make Blueprint better for you."}
            />
          </label>
          <div className={s.contactPics}>
            <span>Pictures · optional, up to {MAX_IMAGES}</span>
            <div>
              {images.map((src, i) => (
                <figure key={i}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimize */}
                  <img src={src} alt={`Picture ${i + 1}`} />
                  <button type="button" aria-label={`Remove picture ${i + 1}`} onClick={() => setImages(images.filter((_, k) => k !== i))}>
                    ×
                  </button>
                </figure>
              ))}
              {images.length < MAX_IMAGES ? (
                <label className={`${s.btn} ${s.ghost} ${s.contactAdd}`}>
                  Add picture
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      void add([...(e.target.files ?? [])]);
                      e.target.value = "";
                    }}
                  />
                </label>
              ) : null}
            </div>
          </div>
          <div className={s.contactSend}>
            <button type="submit" className={`${s.btn} ${s.primary}`} disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Send"}
            </button>
            {error ? <span role="alert">{error}</span> : null}
          </div>
        </form>
      )}
    </section>
  );
}
