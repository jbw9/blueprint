"use client";

import type { Anatomy } from "@/lib/map/schema";
import { ExplainedBlock, isExplained } from "@/components/map/blocks";
import { SourceView } from "@/components/map/source-view";
import { SchemaBlock } from "@/components/map/anatomy/schema";
import { RoutesBlock } from "@/components/map/anatomy/routes";
import { ChipsBlock } from "@/components/map/anatomy/chips";
import { PartsBlock } from "@/components/map/anatomy/parts";
import { BarsBlock } from "@/components/map/anatomy/bars";
import { FlowBlock } from "@/components/map/anatomy/flow";
import { Facts } from "@/components/map/anatomy/facts";
import { MapRows } from "@/components/map/anatomy/map-rows";

/**
 * Level 2 renders in the SHAPE of the thing it describes, and the rows are the
 * point. Clicking a row lights it and greys everything else.
 */

export interface RowCtx {
  /** The row clicked last, which stays lit while the others recede. */
  traced: string | null;
  onTrace: (id: string) => void;
  /**
   * The row on the open path, if the level below came from a row. Lights the
   * row you drilled through, the same way a card stays selected.
   */
  open: string | null;
  /** Drill into the level this row owns. Same gesture as opening a card. */
  onOpenRow: (id: string) => void;
  /**
   * Show the lines a step cites (`Step.at`), over the page. Set only on the
   * open level, where there is room for the code; a step with `at` then opens
   * its code instead of tracing.
   */
  onStepCode?: (at: string, heading: string, detail?: string) => void;
}

export function AnatomyView({
  owner,
  blocks,
  ctx,
  headless,
}: {
  owner: string;
  blocks: Anatomy[];
  ctx: RowCtx;
  /** Drawn inside a row that already names the block, so its own header and frame would say it twice. */
  headless?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => (
        <Block key={i} owner={owner} block={block} ctx={ctx} headless={headless} />
      ))}
    </div>
  );
}

function Block({
  owner,
  block,
  ctx,
  headless,
}: {
  owner: string;
  block: Anatomy;
  ctx: RowCtx;
  headless?: boolean;
}) {
  if (block.kind === "schema") {
    return <SchemaBlock owner={owner} block={block} ctx={ctx} headless={headless} />;
  }

  if (block.kind === "routes") {
    return <RoutesBlock owner={owner} block={block} ctx={ctx} />;
  }

  if (block.kind === "source") {
    return <SourceView owner={owner} block={block} ctx={ctx} />;
  }

  if (isExplained(block)) return <ExplainedBlock block={block} />;

  if (block.kind === "chips") {
    return <ChipsBlock owner={owner} block={block} ctx={ctx} />;
  }

  if (block.kind === "map") return <MapRows owner={owner} block={block} ctx={ctx} />;

  if (block.kind === "parts") {
    return <PartsBlock owner={owner} block={block} ctx={ctx} />;
  }

  if (block.kind === "bars") {
    return <BarsBlock owner={owner} block={block} ctx={ctx} />;
  }

  if (block.kind === "flow") {
    return <FlowBlock owner={owner} block={block} ctx={ctx} />;
  }

  return <Facts owner={owner} block={block} ctx={ctx} />;
}
