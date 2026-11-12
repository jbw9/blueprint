"use client";

import { motion } from "motion/react";
import { PhoneIcon } from "@/components/agent/tab-icons";
import type { Platform } from "@/components/preview/device";
import { GAP, STATUSBAR } from "@/lib/client/layout";

/**
 * A project with a phone app is asked, once, whether to run it here. Picking
 * one opens its tab, which says what it needs before anything is installed.
 */
export function Offer({ phones, onPick, onDismiss }: { phones: Platform[]; onPick: (p: Platform) => void; onDismiss: () => void }) {
  const what = phones.length > 1 ? "iOS and Android apps" : phones[0] === "ios" ? "an iOS app" : "an Android app";
  return (
    <motion.div
      role="dialog"
      aria-label="Run the phone app here"
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      style={{ bottom: STATUSBAR + GAP }}
      className="fixed left-3 z-40 flex max-w-[360px] flex-col gap-3.5 rounded-lg border border-border-gray bg-card p-4 shadow-lift"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded bg-surface-container text-ink [&>svg]:size-4">
          <PhoneIcon />
        </span>
        <p className="text-[14px] font-medium leading-snug text-ink" title={`This project has ${what}.`}>
          Run the phone app here
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {phones.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded bg-accent px-3.5 text-[13px] font-medium text-on-accent transition-[background-color,transform] duration-150 hover:bg-accent-strong active:scale-[0.97]"
          >
            <PhoneIcon />
            {p === "ios" ? "iOS Simulator" : "Android emulator"}
          </button>
        ))}
        <button type="button" onClick={onDismiss} className="ml-auto h-8 cursor-pointer rounded px-2 text-[13px] text-muted-slate transition-colors hover:bg-surface-container hover:text-ink">
          Not now
        </button>
      </div>
    </motion.div>
  );
}
