import { useCallback, useSyncExternalStore } from "react";

/**
 * The tabs inside one bluprint: each holds a level (its path, as the URL's `at=`
 * spells it), so two sections of the same project can be open side by side
 * and swapped between. Kept per bluprint and per machine in localStorage, like the
 * settings. The tab in front always holds the URL's level: moving around the
 * bluprint moves that tab, and bringing another to the front opens its level.
 */
export interface Tab {
  id: number;
  path: string[];
  /** A whole file open over the level (components/bluprint/code.tsx), as `?file=` spells it. */
  file?: string;
}
export interface Tabs {
  tabs: Tab[];
  active: number;
}

const CHANGED = "bluprint:tabs-changed";
const keyOf = (bluprint: string) => `bluprint:tabs:${bluprint}`;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function raw(bluprint: string) {
  try {
    return localStorage.getItem(keyOf(bluprint)) ?? "";
  } catch {
    return "";
  }
}

// Parsed once per distinct value, so the snapshot keeps its identity between
// renders, as useSyncExternalStore requires.
const cached = new Map<string, { raw: string; value: Tabs | null }>();

export function readTabs(bluprint: string): Tabs | null {
  const r = raw(bluprint);
  const hit = cached.get(bluprint);
  if (hit && hit.raw === r) return hit.value;
  let value: Tabs | null = null;
  try {
    const parsed = JSON.parse(r) as Tabs;
    if (Array.isArray(parsed.tabs) && parsed.tabs.length && parsed.tabs.some((t) => t.id === parsed.active)) value = parsed;
  } catch {
    /* unreadable: no tabs yet */
  }
  cached.set(bluprint, { raw: r, value });
  return value;
}

function save(bluprint: string, next: Tabs) {
  try {
    localStorage.setItem(keyOf(bluprint), JSON.stringify(next));
  } catch {
    /* not kept; nothing else to do */
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** The tab in front follows the level on screen, and the file over it; the first visit makes it. */
export function follow(bluprint: string, path: string[], file?: string) {
  const t = readTabs(bluprint);
  if (!t) return save(bluprint, { tabs: [{ id: 1, path, file }], active: 1 });
  const front = t.tabs.find((x) => x.id === t.active)!;
  if (!same(front.path, path) || front.file !== file)
    save(bluprint, { ...t, tabs: t.tabs.map((x) => (x.id === t.active ? { id: x.id, path, ...(file ? { file } : {}) } : x)) });
}

// The tab last opened, and when, so the strip can mark it as it arrives:
// opened from inside the page, it would otherwise appear without a sign.
let opened = { id: 0, at: 0 };
/** Whether the tab `id` was opened a moment ago. */
export const justOpened = (id: number) => opened.id === id && Date.now() - opened.at < 1500;

/** A new tab beside the one in front, holding `path` (and `file` over it), brought to the front. */
export function openTab(bluprint: string, path: string[], file?: string) {
  const t = readTabs(bluprint) ?? { tabs: [], active: 0 };
  const id = Math.max(0, ...t.tabs.map((x) => x.id)) + 1;
  opened = { id, at: Date.now() };
  const at = t.tabs.findIndex((x) => x.id === t.active);
  const tabs = [...t.tabs];
  tabs.splice(at + 1, 0, { id, path, ...(file ? { file } : {}) });
  save(bluprint, { tabs, active: id });
}

/** A new tab at `index` along the strip, holding `path`, brought to the front: a part dropped between two tabs. */
export function insertTab(bluprint: string, path: string[], index: number) {
  const t = readTabs(bluprint) ?? { tabs: [], active: 0 };
  const id = Math.max(0, ...t.tabs.map((x) => x.id)) + 1;
  const tabs = [...t.tabs];
  tabs.splice(index, 0, { id, path });
  save(bluprint, { tabs, active: id });
}

/** A tab made to hold `path` instead of what it held, brought to the front: a part dropped onto it. */
export function replaceTab(bluprint: string, id: number, path: string[]) {
  const t = readTabs(bluprint);
  if (!t?.tabs.some((x) => x.id === id)) return;
  save(bluprint, { tabs: t.tabs.map((x) => (x.id === id ? { id, path } : x)), active: id });
}

/** Brings a tab to the front, and says what it holds to open. */
export function selectTab(bluprint: string, id: number): Tab | null {
  const t = readTabs(bluprint);
  const tab = t?.tabs.find((x) => x.id === id);
  if (!t || !tab) return null;
  save(bluprint, { ...t, active: id });
  return tab;
}

/**
 * Closes a tab. If it was in front, the one to its right comes forward (else
 * the one to its left), and what it holds is returned to open. The last tab stays.
 */
export function closeTab(bluprint: string, id: number): Tab | null {
  const t = readTabs(bluprint);
  if (!t || t.tabs.length < 2) return null;
  const at = t.tabs.findIndex((x) => x.id === id);
  const tabs = t.tabs.filter((x) => x.id !== id);
  if (id !== t.active) {
    save(bluprint, { ...t, tabs });
    return null;
  }
  const next = tabs[at] ?? tabs[at - 1];
  save(bluprint, { tabs, active: next.id });
  return next;
}

const subscribe = (f: () => void) => {
  window.addEventListener(CHANGED, f);
  return () => window.removeEventListener(CHANGED, f);
};

export function useTabs(bluprint: string): Tabs | null {
  const read = useCallback(() => readTabs(bluprint), [bluprint]);
  return useSyncExternalStore(subscribe, read, () => null);
}
