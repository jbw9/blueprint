/**
 * What app/layout.tsx needs to set the theme before first paint. Kept apart
 * from lib/client/settings.ts, which uses React hooks and so cannot be imported by a
 * server component.
 */

export const SETTINGS_KEY = "blueprint.settings";
const THEMES = ["classic", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** A saved theme, or Classic for none and for one this version no longer has. */
export const themeOf = (t: unknown): Theme => (THEMES.includes(t as Theme) ? (t as Theme) : "classic");

/**
 * Keys saved before the app was renamed from slop or bluprint ("slop.settings",
 * "bluprint:tabs:…") move to their Blueprint names once, before anything reads them.
 */
const RENAME = `try{for(var i=localStorage.length-1;i>=0;i--){var k=localStorage.key(i);var m=k&&/^(slop|bluprint)([.:].*)$/.exec(k);if(m){var n="blueprint"+m[2];if(localStorage.getItem(n)===null)localStorage.setItem(n,localStorage.getItem(k));localStorage.removeItem(k)}}}catch(e){}`;

/** applyTheme (lib/client/settings.ts) as an inline script, so the page never flashes another theme. */
export const THEME_SCRIPT = `${RENAME}try{var t=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)})||"{}").theme;document.documentElement.dataset.theme=${JSON.stringify(THEMES)}.indexOf(t)<0?"classic":t}catch(e){document.documentElement.dataset.theme="classic"}`;
