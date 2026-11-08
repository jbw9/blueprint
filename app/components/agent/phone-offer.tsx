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
      className="fixed left-3 z-40 flex max-w-[360px] flex-col gap-3 border border-accent border-l-4 bg-card p-4 shadow-lift"
    >
      {/* A few pulses on arrival so the eye lands on it, then it stays still. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -inset-px border-2 border-accent"
        initial={{ opacity: 0.7, scale: 1 }}
        animate={{ opacity: 0, scale: 1.06 }}
        transition={{ duration: 1.2, ease: "easeOut", repeat: 2, delay: 0.3 }}
      />
      <div className="flex items-start gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center bg-accent-surface text-accent [&>svg]:size-4">
          <PhoneIcon />
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="text-[14px] font-semibold leading-snug text-ink">Run the phone app here</p>
          <p className="text-[12.5px] leading-snug text-muted-slate">
            This project has {what}. Run {phones.length > 1 ? "them" : "it"} right here, in the app.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {phones.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="flex cursor-pointer items-center gap-1.5 border border-accent bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:border-accent-strong hover:bg-accent-strong"
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
