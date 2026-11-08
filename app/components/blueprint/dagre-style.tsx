"use client";

import { createContext, useContext } from "react";

/** The landing's frames draw diagrams as dagre would (lib/blueprint/dagre.ts); the app keeps its grid router. */
const Dagre = createContext(false);

export function DagreDiagrams({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <Dagre value={on}>{children}</Dagre>;
}

export const useDagre = () => useContext(Dagre);
