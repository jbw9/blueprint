import { gh } from "@/lib/server/review";

/**
 * A checkout's open GitHub issues, read through the GitHub CLI as pull
 * requests are (lib/server/review.ts), and one issue in full: what the
 * Issues tab lists (components/review/issues.tsx) and what Claude is given.
 */

export interface Issue {
  number: number;
  title: string;
  labels: string[];
  author: string;
  at: string;
  url: string;
}

export interface IssueComment {
  author: string;
  at: string;
  body: string;
}

export interface FullIssue extends Issue {
  body: string;
  state: string;
  comments: IssueComment[];
  /** The issue as Claude reads it. */
  text: string;
}

const NO_GH = "Issues need the GitHub CLI (`gh`), installed and signed in, in a checkout with a GitHub remote.";
/** The comments Claude is given: the newest, which say where the issue stands. */
const KEPT = 10;

type Raw = { number: number; title: string; labels?: { name: string }[]; author?: { login?: string }; createdAt: string; url: string };
const issueOf = (r: Raw): Issue => ({ number: r.number, title: r.title, labels: (r.labels ?? []).map((l) => l.name), author: r.author?.login ?? "", at: r.createdAt, url: r.url });

export type IssueState = "open" | "closed";

/** Open or closed issues, newest first, or why there are none to show. */
export function issues(root: string, state: IssueState): { issues: Issue[] } | { why: string } {
  const out = gh(root, ["issue", "list", "--state", state, "--limit", "100", "--json", "number,title,labels,author,createdAt,url"]);
  if (out === null) return { why: NO_GH };
  return { issues: (JSON.parse(out) as Raw[]).map(issueOf) };
}

/** One issue with its body and comments, and the text Claude is given for it. */
export function issue(root: string, n: number): FullIssue | { error: string } {
  const out = gh(root, ["issue", "view", String(n), "--json", "number,title,labels,author,createdAt,url,body,state,comments"]);
  if (out === null) return { error: `Could not read issue #${n}. ${NO_GH}` };
  const r = JSON.parse(out) as Raw & { body?: string; state: string; comments?: { author?: { login?: string }; createdAt: string; body: string }[] };
  const base = issueOf(r);
  const comments = (r.comments ?? []).map((c) => ({ author: c.author?.login ?? "", at: c.createdAt, body: c.body.trim() }));
  const body = (r.body ?? "").trim();
  const kept = comments.slice(-KEPT);
  const text = [
    `[GitHub issue #${base.number}: ${base.title}]`,
    base.url,
    [r.state.toLowerCase(), base.labels.join(", "), `opened by ${base.author} on ${base.at.slice(0, 10)}`, `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`].filter(Boolean).join(" · "),
    "",
    body || "(No description.)",
    ...(kept.length
      ? ["", comments.length > kept.length ? `The last ${kept.length} of ${comments.length} comments, oldest first:` : "Comments, oldest first:", ...kept.map((c) => `- ${c.author}: ${c.body}`)]
      : []),
  ].join("\n");
  return { ...base, body, state: r.state, comments, text };
}

export type CloseReason = "completed" | "not planned";

/** Closes an issue on GitHub, as completed or as not planned; null when it is closed. */
export function closeIssue(root: string, n: number, reason: CloseReason): string | null {
  return gh(root, ["issue", "close", String(n), "--reason", reason]) === null ? `Could not close issue #${n}. ${NO_GH}` : null;
}

/** Opens a closed issue again; null when it is open. */
export function reopenIssue(root: string, n: number): string | null {
  return gh(root, ["issue", "reopen", String(n)]) === null ? `Could not reopen issue #${n}. ${NO_GH}` : null;
}

/** The longest comment GitHub takes. */
export const COMMENT_MAX = 65_536;

/** Comments on an issue as the signed-in GitHub user; null when it is posted. */
export function commentOn(root: string, n: number, body: string): string | null {
  return gh(root, ["issue", "comment", String(n), "--body-file", "-"], body) === null ? `Could not comment on issue #${n}. ${NO_GH}` : null;
}
