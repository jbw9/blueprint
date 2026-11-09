"use client";

import { useEffect } from "react";

// The admin dashboard's backend (app/scripts/api).
const API_URL = "https://rn24aj5jclm6ioyeqrlsxbztky0bfwgc.lambda-url.us-east-1.on.aws";

const stored = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

/**
 * Counts a visit for the admin dashboard: one anonymous id per browser,
 * where it came from, and the country and region its IP is in (geojs.io,
 * looked up once a day). A browser that has opened the dashboard is ours
 * and is not counted. Renders nothing.
 */
export function LandingVisit() {
  useEffect(() => {
    if (stored("bp-team")) return;
    const keep = (k: string, v: string) => {
      try {
        localStorage.setItem(k, v);
      } catch {}
    };
    let vid = stored("bp-visitor");
    if (!vid) keep("bp-visitor", (vid = crypto.randomUUID()));
    const day = new Date().toISOString().slice(0, 10);
    type Place = { day?: string; country?: string; region?: string };
    let kept: Place | null = null;
    try {
      kept = JSON.parse(stored("bp-geo") ?? "null");
    } catch {}
    const place: Promise<Place> =
      kept?.day === day
        ? Promise.resolve(kept)
        : fetch("https://get.geojs.io/v1/ip/geo.json")
            .then((r) => r.json())
            .then((g: Place) => {
              const p = { day, country: g.country, region: g.region };
              keep("bp-geo", JSON.stringify(p));
              return p;
            })
            .catch(() => ({}));
    const referrer = document.referrer && new URL(document.referrer).host !== location.host ? new URL(document.referrer).host : null;
    // A tagged link names where it was posted: ?utm_source=… or ?ref=….
    const q = new URLSearchParams(location.search);
    void place.then((p) =>
      fetch(`${API_URL}/rpc/bp_track_visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vid,
          path: location.pathname,
          referrer,
          country: p.country ?? null,
          region: p.region ?? null,
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
  const vid = stored("bp-visitor");
  if (!vid || stored("bp-team")) return;
  void fetch(`${API_URL}/rpc/bp_track_visit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vid, copied: true }),
    keepalive: true,
  }).catch(() => {});
}
