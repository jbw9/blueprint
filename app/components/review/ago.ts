const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago", as a history list says it. */
export function ago(iso: string) {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  for (const [unit, size] of UNITS) if (Math.abs(s) >= size) return RTF.format(Math.round(s / size), unit);
  return "just now";
}
