"use client";

import { useEffect, useState } from "react";

// Blueprint's backend (app/scripts/api/credit.mjs), the same the landing page asks (components/landing-promo.tsx).
const API_URL = "https://rn24aj5jclm6ioyeqrlsxbztky0bfwgc.lambda-url.us-east-1.on.aws";

/** When the promotion ends, as Blueprint's backend has it now, so the date changes without a redeploy. */
export function PromotionEnd() {
  const [p, setP] = useState<{ on?: boolean; ends_at?: string | null } | null>(null);
  useEffect(() => {
    fetch(`${API_URL}/promo`)
      .then((r) => r.json())
      .then(setP, () => setP({}));
  }, []);
  if (!p) return <>Checking whether the promotion is on…</>;
  if (!p.on) return <>The promotion is not running right now.</>;
  if (!p.ends_at) return <>The promotion is running. No end date is set yet. When one is, it shows here and in Blueprint&rsquo;s Settings.</>;
  const at = new Date(p.ends_at).toLocaleString([], { dateStyle: "long", timeStyle: "short" });
  return <>The promotion is running and ends on {at}.</>;
}
