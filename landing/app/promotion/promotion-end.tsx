"use client";

import { useEffect, useState } from "react";

// Blueprint's backend (app/scripts/api/credit.mjs), the same the landing page asks (components/landing-promo.tsx).
const API_URL = "https://rn24aj5jclm6ioyeqrlsxbztky0bfwgc.lambda-url.us-east-1.on.aws";

/** When the promotion ends, as Blueprint's backend has it now, so the date changes without a redeploy. */
export function PromotionEnd() {
  const [p, setP] = useState<{ on?: boolean; ends_at?: string | null; failed?: true } | null>(null);
  useEffect(() => {
    fetch(`${API_URL}/promo`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setP, () => setP({ failed: true }));
  }, []);
  if (!p) return <>Checking whether the promotion is on…</>;
  // Not reaching the server says nothing about the promotion, so it isn't reported as off.
  if (p.failed) return <>Couldn&rsquo;t reach Blueprint&rsquo;s server to check whether the promotion is on. Reload the page to try again.</>;
  if (!p.on) return <>The promotion is not running right now.</>;
  // The server reads an end it can't parse as none (credit.mjs, ended).
  const end = p.ends_at ? new Date(p.ends_at) : null;
  if (!end || isNaN(end.getTime()))
    return <>The promotion is running. No end date is set yet. When one is, it shows here and in Blueprint&rsquo;s Settings.</>;
  // The reader's own time, with its zone named, so a date near midnight isn't read as the wrong day.
  const at = end.toLocaleString([], { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return <>The promotion is running and ends on {at}.</>;
}
