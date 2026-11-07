export type Size = { w: number; h: number };

/** Space around a sized viewport, where its handles sit. */
export const PAD = 20;
const MIN = 200;
const MAX = 3840;
const SIZE_KEY = "slop.preview.size:";

export const clamp = (n: number) => Math.max(MIN, Math.min(MAX, Math.round(n)));

export function storedSize(root: string): Size | null {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_KEY + root) ?? "null") as Size | null;
    if (v && v.w >= MIN && v.h >= MIN) return v;
  } catch {
    /* storage blocked: fill the tab */
  }
  return null;
}

export function keepSize(root: string, size: Size | null) {
  try {
    if (size) localStorage.setItem(SIZE_KEY + root, JSON.stringify(size));
    else localStorage.removeItem(SIZE_KEY + root);
  } catch {
    /* applies until reload */
  }
}
