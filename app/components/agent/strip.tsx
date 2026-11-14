"use client";

import { invoke } from "@tauri-apps/api/core";
import { AgentIcon, CLAUDE, CLAUDE_CODE, agentById, type Agent } from "@/components/agent/agents";
import type { Tab } from "@/components/agent/workspace-tab";
import { openSettings } from "@/lib/client/settings";

/**
 * The agent in front in a tab, if any: the one whose launcher says so,
 * else the agent last started there while the shell is busy with something.
 */
export function inFront(t: Tab): Agent | undefined {
  if (t.live) return agentById(t.agent) ?? CLAUDE;
  if (t.busy && t.ran !== CLAUDE.id) return agentById(t.ran ?? undefined);
  return undefined;
}

/**
 * The line under the terminal, with the shell at its prompt: the agents to
 * start here. What is handed to Claude is named in its prompt instead
 * (lib/agent/context.ts `mention`).
 */
export function Strip({
  tab,
  pty,
  agents,
  onRun,
}: {
  tab: Tab;
  pty: number;
  agents: Agent[];
  onRun: (id: string) => void;
}) {
  if (tab.live || tab.busy) return null;
  const run = (a: Agent) => {
    onRun(a.id);
    void invoke("pty_write", { id: pty, data: `${a.command}\r` });
  };
  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-border-gray px-3 py-1.5 text-[12px] [scrollbar-width:none]">
      {agents.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => run(a)}
          title={
            a.id === CLAUDE.id
              ? "Runs blueprint-claude in this shell: Claude Code with the blueprint's context and tools, on Blueprint credit when Settings has it on"
              : a.id === CLAUDE_CODE.id
                ? "Runs claude-code in this shell: your own Claude Code as in any terminal, with no blueprint context, always on your Claude plan"
                : `Runs ${a.command} in this shell: your ${a.label}, able to take blueprint context`
          }
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded bg-surface-container px-2.5 font-medium text-ink transition-[background-color,transform] duration-150 hover:bg-surface-dim active:scale-[0.97]"
        >
          <AgentIcon id={a.id} />
          {a.label}
        </button>
      ))}
      {tab.found === false ? (
        <span className="shrink-0 text-faint">
          Claude Code was not found.{" "}
          <button type="button" onClick={openSettings} className="cursor-pointer text-accent underline">
            Open Settings
          </button>
        </span>
      ) : null}
    </div>
  );
}
