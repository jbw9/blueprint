"use client";

import { isTauri } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** Whether keys are a Mac's. False on the server, so the first paint hydrates, then the truth. */
export const useMac = () => useSyncExternalStore(noSubscribe, isMac, () => false);

/** Whether this is the desktop app's own page, not a copy of it framed in a Preview. */
export const isDesktop = () => isTauri() && window === window.top;

/** Whether this is the desktop app. False on the server, so the first paint hydrates, then the truth. */
export const useDesktop = () => useSyncExternalStore(noSubscribe, isDesktop, () => false);
