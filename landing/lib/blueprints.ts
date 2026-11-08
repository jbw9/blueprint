import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A box of the blueprint's top-level picture, and an arrow between two, as the blueprint file has them. */
export interface Diagram {
  boxes: { id: string; label: string; sub?: string; col: number; row: number }[];
  arrows: { from: string; to: string; label: string }[];
}

export interface DemoNode {
  id: string;
  title: string;
  sub?: string;
  children?: DemoNode[];
  anatomy?: ({ kind: string } & Diagram)[];
}

/** What the page reads of a committed blueprint: its run, and its tree's titles. */
export interface DemoFile {
  RUN: { files?: number; commit?: string };
  AUTHORED: DemoNode[];
  OVERVIEW: { anatomy: ({ kind: string } & Diagram)[] };
}

/**
 * The demo blueprints, kept with this page (landing/demo) now that the app ships
 * none (D63), read at build time: the page is static.
 */
export const loadBlueprint = (id: string): DemoFile =>
  JSON.parse(readFileSync(join(process.cwd(), "demo", id, "blueprint.json"), "utf8"));
