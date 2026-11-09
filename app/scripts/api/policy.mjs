// What a credit call may be. The credit pays for Claude Code in Blueprint's tabs and for Blueprint's
// map generation, so a call has to look like one of them. A `tab` call carries the attribution block
// Claude Code puts first in its system prompt, and a main-conversation call also carries Blueprint's
// own appended prompt (src-tauri/src/claude.rs). A `gen` call offers the model only the generator's
// tools (scripts/generate). Anyone can copy a shape, so this is a fence, not a lock: what holds is
// each account's small allowance (credit.mjs).
//
// With `policy` "log", a call out of shape still goes through, flagged in its record (req#); with
// "enforce", it is refused. Either way every call is held to a size: output stops at `max_tokens`,
// and the 1M-token context is never asked for.

const CLAUDE_CODE = "cc_version=";
const MAIN = "You are Claude Code";
const BLUEPRINT = "This session was opened from Blueprint";

/** Every tool the generator offers a model, as its stages name them. */
const GEN_TOOLS = new Set([
  "answer", "blueprint_search", "blueprint_section", "blueprint_where", "component", "cut", "files", "grade", "graph_callees", "graph_callers",
  "graph_entrypoints", "graph_file", "graph_find", "graph_links", "graph_path", "graph_show", "grep", "groups", "leaves", "levels", "list",
  "overview", "parts", "place", "read_file", "shortened", "story", "submit", "summaries", "summary",
]);

const textOf = (system) =>
  typeof system === "string" ? system : Array.isArray(system) ? system.map((b) => (typeof b?.text === "string" ? b.text : "")).join("\n") : "";

/** The call as it goes to Bedrock, and what about it is out of shape; no body when it is not a call at all. */
export function shape({ lane, body, headers, maxTokens }) {
  let j;
  try {
    j = JSON.parse(body.toString("utf8"));
  } catch {
    return { flags: ["not-json"] };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { flags: ["not-json"] };

  const flags = [];
  const system = textOf(j.system);
  if (lane === "tab") {
    if (!system.includes(CLAUDE_CODE)) flags.push("not-claude-code");
    // Only the main conversation has Blueprint's prompt appended; subagents, titles and compaction have their own.
    const cls = headers["x-claude-code-request-class"];
    if ((cls === "main" || (!cls && system.includes(MAIN))) && !system.includes(BLUEPRINT)) flags.push("not-blueprint");
  } else {
    if (system.includes(MAIN) || system.includes(CLAUDE_CODE)) flags.push("not-generator");
    // Every generator call answers through a tool (scripts/generate/bedrock.ts `ask`, author.ts), so one with none is plain chat.
    const tools = Array.isArray(j.tools) ? j.tools : [];
    if (!tools.length) flags.push("no-tools");
    if (tools.some((t) => !GEN_TOOLS.has(t?.name))) flags.push("not-generator-tool");
  }

  if (!(typeof j.max_tokens === "number" && j.max_tokens <= maxTokens)) j.max_tokens = maxTokens;
  if (j.thinking?.type === "enabled" && !(j.thinking.budget_tokens < j.max_tokens)) j.thinking.budget_tokens = Math.max(1024, j.max_tokens - 1024);
  if (Array.isArray(j.anthropic_beta)) j.anthropic_beta = j.anthropic_beta.filter((b) => !/^context-1m/.test(String(b)));
  return { body: Buffer.from(JSON.stringify(j)), flags, maxTokens: j.max_tokens };
}
