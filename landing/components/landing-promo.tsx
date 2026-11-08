"use client";

import { useEffect, useState } from "react";

// Blueprint's backend (app/scripts/api), which says whether the promotion is on.
const API_URL = "https://rn24aj5jclm6ioyeqrlsxbztky0bfwgc.lambda-url.us-east-1.on.aws";

let asked: Promise<boolean> | undefined;
// `?promo` shows it whatever the backend says, to see the page as it will be before the promotion starts.
const promoOn = () =>
  (asked ??= new URLSearchParams(location.search).has("promo") ? Promise.resolve(true) : fetch(`${API_URL}/promo`)
    .then((r) => r.json() as Promise<{ on?: boolean }>)
    .then((p) => p.on === true)
    .catch(() => false));

/**
 * Its children, only while Blueprint's free Claude Code promotion is on, so the page says nothing
 * of it before it starts or after it ends, without a redeploy.
 */
export function LandingPromo({ children }: { children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => void promoOn().then(setOn), []);
  return on ? children : null;
}
