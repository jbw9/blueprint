"use client";

import { useEffect, useState } from "react";
import ELK from "elkjs/lib/elk-api";
import type { Anatomy } from "@/lib/blueprint/schema";
import { layoutDiagramElk, type DiagramLayout, type Elk } from "@/lib/blueprint/diagram-elk";

type Block = Extract<Anatomy, { kind: "diagram" }>;

const MAX_KEPT = 200;
const done = new Map<string, DiagramLayout | null>();
const waiting = new Map<string, Promise<DiagramLayout | null>>();
let elk: Elk | null = null;
let queue: Promise<unknown> = Promise.resolve();

function ask(key: string, block: Block) {
  const busy = waiting.get(key);
  if (busy) return busy;
  elk ??= new ELK({ workerFactory: () => new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url)) });
  const engine = elk;
  // One diagram at a time: each tries about forty layouts, and the one on
  // screen first should not wait behind all the others' attempts.
  const p = queue
    .then(() => layoutDiagramElk(block, engine))
    .catch(() => null)
    .then((layout) => {
      waiting.delete(key);
      if (done.size >= MAX_KEPT) done.delete(done.keys().next().value!);
      done.set(key, layout);
      return layout;
    });
  queue = p;
  waiting.set(key, p);
  return p;
}

/**
 * The ELK layout of a diagram (lib/blueprint/diagram-elk.ts), with ELK itself
 * in a worker, kept per diagram so a level opened again draws at once.
 * `undefined` while it works; `null` where ELK failed and the grid stands.
 */
export function useDiagramLayout(block: Block): DiagramLayout | null | undefined {
  const key = JSON.stringify([block.boxes, block.arrows]);
  const [got, setGot] = useState<{ key: string; layout: DiagramLayout | null } | null>(null);
  useEffect(() => {
    if (done.has(key)) return;
    let live = true;
    ask(key, block).then((layout) => live && setGot({ key, layout }));
    return () => {
      live = false;
    };
  }, [key, block]);
  if (done.has(key)) return done.get(key);
  return got?.key === key ? got.layout : undefined;
}
