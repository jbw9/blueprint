"use client";

import { useEffect } from "react";

// The admin dashboard's backend (app/scripts/api).
const API_URL = "https://rn24aj5jclm6ioyeqrlsxbztky0bfwgc.lambda-url.us-east-1.on.aws";

/**
 * Counts a visit for the admin dashboard: one anonymous id per browser,
 * where it came from, and the country its IP is in (geojs.io, looked up
 * once a day). Renders nothing.
 */
export function LandingVisit() {
  useEffect(() => {
    const stored = (k: string) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    };
    const keep = (k: string, v: string) => {
      try {
        localStorage.setItem(k, v);
      } catch {}
    };
    let vid = stored("bp-visitor");
    if (!vid) keep("bp-visitor", (vid = crypto.randomUUID()));
    const day = new Date().toISOString().slice(0, 10);
    const geo = stored("bp-geo");
    const country: Promise<string | null> =
      geo?.startsWith(day + " ")
        ? Promise.resolve(geo.slice(11) || null)
        : fetch("https://get.geojs.io/v1/ip/country.json")
            .then((r) => r.json())
            .then((g: { name?: string }) => {
              keep("bp-geo", `${day} ${g.name ?? ""}`);
              return g.name ?? null;
            })
            .catch(() => null);
    const referrer = document.referrer && new URL(document.referrer).host !== location.host ? new URL(document.referrer).host : null;
    // A tagged link names where it was posted: ?utm_source=… or ?ref=….
    const q = new URLSearchParams(location.search);
    void country.then((c) =>
      fetch(`${API_URL}/rpc/bp_track_visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vid,
          path: location.pathname,
          referrer,
          country: c,
          source: q.get("utm_source") ?? q.get("ref"),
          medium: q.get("utm_medium"),
          campaign: q.get("utm_campaign"),
        }),
        keepalive: true,
      }).catch(() => {}),
    );
  }, []);
  return null;
}

/** Marks this browser's visit today as one that copied the install command. */
export function copiedInstall() {
  let vid: string | null = null;
  try {
    vid = localStorage.getItem("bp-visitor");
  } catch {}
  if (!vid) return;
  void fetch(`${API_URL}/rpc/bp_track_visit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vid, copied: true }),
    keepalive: true,
  }).catch(() => {});
}
