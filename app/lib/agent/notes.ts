import { useSyncExternalStore } from "react";
import { hurry, sendBatch, type Target } from "@/lib/agent/context";
import { signal } from "@/lib/client/signal";

/**
 * A review of what is on screen: notes pinned to things on the blueprint, in a diff
 * or in the code, collected in the review tray (components/review/review-tray.tsx) and
 * sent to Claude together as one turn.
 *
 * A note is a comment ("this should retry") on one thing.
 *
 * Kept per blueprint in localStorage, so a review half written survives a reload.
 */

export interface Note {
  id: string;
  /** What it is pinned to, and that thing's text for Claude (lib/agent/context.ts). */
  anchor: Target;
  note: string;
  status: "draft" | "sending" | "sent";
}

/** Where the editor for a new note opens, and what it is for. */
export interface Editing {
  x: number;
  y: number;
  anchor: Target;
}

interface State {
  blueprint: string | null;
  notes: Note[];
  editing: Editing | null;
}

let state: State = { blueprint: null, notes: [], editing: null };
const { subscribe, emit } = signal();
const set = (next: State) => {
  state = next;
  if (next.blueprint) {
    try {
      localStorage.setItem(KEY + next.blueprint, JSON.stringify(next.notes.filter((n) => n.status !== "sent")));
    } catch {}
  }
  emit();
};
const KEY = "blueprint.review.";

/** The open blueprint: its notes are loaded, and the next ones are kept with it. */
export function reviewFor(blueprint: string) {
  if (state.blueprint === blueprint) return;
  let notes: Note[] = [];
  try {
    // Suggested edits are gone; one kept from before is dropped.
    notes = (JSON.parse(localStorage.getItem(KEY + blueprint) ?? "[]") as (Note & { kind?: string })[])
      .filter((n) => n.kind !== "suggest")
      .map((n) => ({ ...n, status: "draft" as const }));
  } catch {}
  set({ blueprint, notes, editing: null });
}

export function startNote(e: Editing) {
  set({ ...state, editing: e });
}

export function stopEditing() {
  if (state.editing) set({ ...state, editing: null });
}

export function addNote(n: Omit<Note, "id" | "status">) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  set({ ...state, editing: null, notes: [...state.notes, { ...n, id, status: "draft" }] });
}

export function editNote(id: string, change: Partial<Pick<Note, "note">>) {
  set({ ...state, notes: state.notes.map((n) => (n.id === id ? { ...n, ...change } : n)) });
}

export function dropNote(id: string) {
  set({ ...state, notes: state.notes.filter((n) => n.id !== id) });
}

export function clearSent() {
  set({ ...state, notes: state.notes.filter((n) => n.status !== "sent") });
}

/** What Claude reads for one note: the thing as the blueprint describes it, then the note. */
function describeNote(n: Note): string {
  return [`[Review comment — ${n.anchor.title}]`, n.anchor.text, `Comment: ${n.note.trim()}`].join("\n");
}

/**
 * Sends every draft note as one turn: each goes to Claude as context with a
 * short prompt saying what to do with them, and `extra` is added to it. Waits
 * for Claude to finish whatever it is doing first.
 */
export async function sendReview(extra: string, now = false) {
  const drafts = state.notes.filter((n) => n.status === "draft");
  if (!drafts.length) return;
  const ids = new Set(drafts.map((n) => n.id));
  const mark = (status: Note["status"]) => set({ ...state, notes: state.notes.map((n) => (ids.has(n.id) ? { ...n, status } : n)) });
  mark("sending");
  const counted = `${drafts.length} comment${drafts.length === 1 ? "" : "s"}`;
  const question = [
    `Apply my review (${counted}, attached): do what each comment asks. If one is unclear or would be a bad idea, say so instead of guessing.`,
    extra.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    await sendBatch(
      drafts.map((n) => ({ key: `note:${n.id}`, title: n.anchor.title, text: describeNote(n) })),
      question,
      now,
    );
    mark("sent");
  } catch {
    mark("draft");
  }
}

/** While a review waits for Claude to finish: send it now instead (a turn stopped with Escape never says it is done). */
export const sendNow = hurry;

const NONE: Note[] = [];

export function useNotes(): Note[] {
  return useSyncExternalStore(subscribe, () => state.notes, () => NONE);
}

export function useEditing(): Editing | null {
  return useSyncExternalStore(subscribe, () => state.editing, () => null);
}
