import { hostOf } from "@/lib/agent/preview";

/** Everything after the host: `/about?x` of `http://localhost:5173/about?x`. */
export const pathOf = (url: string) => url.replace(/^(?:https?:\/\/)?[^/?#]+/, "") || "/";
export const originOf = (url: string) => (url.match(/^(?:https?:\/\/)?[^/?#]+/)?.[0] ?? url).replace(/^(?!https?:)/, "http://");
export const bare = (url: string) => url.replace(/^https?:\/\//, "");

/** An address off this machine: the web, not a dev server. */
export const isWeb = (url: string) => /^https?:\/\//.test(url) && !hostOf(url);

/** What was typed, as a page from the web: an address, or else a search. */
export const toWeb = (v: string) =>
  /^https?:\/\//.test(v)
    ? v
    : /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(v)
      ? `https://${v}`
      : `https://www.google.com/search?q=${encodeURIComponent(v)}`;

/** A page's site, as sign-ins are kept by (src-tauri/src/signins.rs): `www.instagram.com` is `instagram.com`. */
export const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};
export const covers = (site: string, url: string) => {
  const host = siteOf(url);
  return !!host && (host === site || host.endsWith(`.${site}`));
};

/** Sites a sign-in is offered for all projects first; any other, for this project only. */
export const SHARED = /(^|\.)(instagram|facebook|x|twitter|youtube|google|tiktok|linkedin|reddit|threads|github|vimeo|pinterest)\.(com|net)$|^youtu\.be$/;
