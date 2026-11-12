/**
 * What app/layout.tsx needs to set the theme before first paint. Kept apart
 * from lib/client/settings.ts, which uses React hooks and so cannot be imported by a
 * server component.
 */

export const SETTINGS_KEY = "blueprint.settings";
const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];
const CHOICES = ["dark", "light", "system"] as const;
/** What Settings keeps: a theme, or System, which follows the machine's own. */
export type ThemeChoice = (typeof CHOICES)[number];

/** A saved theme, or Dark for none and for one this version no longer has. */
export const themeOf = (t: unknown): Theme => (THEMES.includes(t as Theme) ? (t as Theme) : "dark");
export const choiceOf = (t: unknown): ThemeChoice => (CHOICES.includes(t as ThemeChoice) ? (t as ThemeChoice) : "dark");

export const DARK_QUERY = "(prefers-color-scheme: dark)";
/** The theme a choice shows now: System is the machine's. */
export const lookOf = (c: ThemeChoice): Theme => (c === "system" ? (matchMedia(DARK_QUERY).matches ? "dark" : "light") : c);

/**
 * Keys saved before the app was renamed from slop or bluprint ("slop.settings",
 * "bluprint:tabs:…") move to their Blueprint names once, before anything reads them.
 */
const RENAME = `try{for(var i=localStorage.length-1;i>=0;i--){var k=localStorage.key(i);var m=k&&/^(slop|bluprint)([.:].*)$/.exec(k);if(m){var n="blueprint"+m[2];if(localStorage.getItem(n)===null)localStorage.setItem(n,localStorage.getItem(k));localStorage.removeItem(k)}}}catch(e){}`;

/** applyTheme (lib/client/settings.ts) as an inline script, so the page never flashes another theme. */
export const THEME_SCRIPT = `${RENAME}try{var t=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)})||"{}").theme;if(t==="system")t=matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light";document.documentElement.dataset.theme=${JSON.stringify(THEMES)}.indexOf(t)<0?"dark":t}catch(e){document.documentElement.dataset.theme="dark"}`;
