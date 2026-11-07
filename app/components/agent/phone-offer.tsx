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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      style={{ bottom: STATUSBAR + GAP }}
      className="fixed left-3 z-40 flex max-w-[340px] flex-col gap-2.5 border border-border-gray bg-card p-3.5 shadow-lift"
    >
      <p className="text-[13px] leading-snug text-ink">
        This project has {what}. Run {phones.length > 1 ? "them" : "it"} here, in the app?
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {phones.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="flex cursor-pointer items-center gap-1.5 border border-border-strong px-2.5 py-1 text-[12px] text-ink hover:bg-surface-container"
          >
            <PhoneIcon />
            {p === "ios" ? "iOS Simulator" : "Android emulator"}
          </button>
        ))}
        <button type="button" onClick={onDismiss} className="ml-auto cursor-pointer px-1 text-[12px] text-faint hover:text-ink">
          Not now
        </button>
      </div>
    </motion.div>
  );
}
