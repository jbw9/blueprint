"use client";

import { Menu } from "@/components/ui/menu";
import { mention, openClaude, type Target } from "@/lib/agent/context";

/** What the picked elements of a page or a phone offer, as the blueprint's PickMenu (components/blueprint/pick.tsx) does. */
export function PickMenu({ x, y, targets, onClose }: { x: number; y: number; targets: Target[]; onClose: () => void }) {
  return (
    <Menu
      x={x}
      y={y}
      title={targets.length > 1 ? `${targets.length} elements` : targets[0].title}
      onClose={onClose}
      items={[
        {
          label: targets.length > 1 ? `Add all ${targets.length} to Claude` : "Add to Claude",
          onClick: () => {
            targets.forEach(mention);
            openClaude();
          },
        },
      ]}
    />
  );
}
