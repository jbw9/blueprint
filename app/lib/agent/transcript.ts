/**
 * The last question and answer of a Claude Code session, read from its
 * transcript, so the blueprint update after a turn knows what the reader asked
 * (scripts/generate/update.ts).
 */

/** What a turn asked and what it answered, read from Claude Code's transcript. */
export interface Exchange {
  asked: string;
  said: string;
}

/**
 * The last question and answer in a session's transcript.
 *
 * Deliberately a copy of the parsing in `scripts/generate/update.ts`'s
 * `account()` rather than a shared helper: that one summarises several turns
 * for a model that is about to rewrite a section, and keeps the tool calls and
 * drops all but the tail of the text. This one needs the opposite — the whole
 * final answer, and no tool noise — and the two will keep wanting different
 * things from the same file.
 */
export function lastExchange(transcript: string, read: (f: string) => string): Exchange | null {
  let entries: unknown[];
  try {
    entries = read(transcript)
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as unknown];
        } catch {
          return [];
        }
      });
  } catch {
    return null;
  }
  type Entry = { type?: string; isMeta?: boolean; message?: { content?: unknown } };
  const content = (e: Entry) => e?.message?.content;
  const text = (c: unknown) =>
    typeof c === "string"
      ? c
      : Array.isArray(c)
        ? c.filter((b) => (b as { type?: string }).type === "text").map((b) => (b as { text?: string }).text ?? "").join("\n")
        : "";
  // A prompt the reader typed, not a tool's result coming back. Matches
  // `account()`'s test, which is the one that has been exercised in anger.
  const asked = (e: Entry) =>
    e.type === "user" &&
    !e.isMeta &&
    (typeof content(e) === "string" ||
      (Array.isArray(content(e)) && !(content(e) as { type?: string }[]).some((b) => b.type === "tool_result")));

  let question = "";
  let answer = "";
  for (const raw of entries as Entry[]) {
    if (asked(raw)) {
      question = text(content(raw));
      // A new question ends the previous answer: only the last pair is kept.
      answer = "";
      continue;
    }
    if (raw.type !== "assistant") continue;
    const t = text(content(raw));
    if (t.trim()) answer = t;
  }
  if (!answer.trim()) return null;
  // The blueprint context the hook prepended is not the reader's question; it is
  // already on the blueprint, and repeating it back would have Claude draft a block
  // about the block it was given.
  const clean = question.replace(/\[Blueprint (?:section|element|problems):[\s\S]*?\]\s*/g, "").trim();
  return { asked: clean.slice(0, 2000), said: answer.trim().slice(0, 12000) };
}
