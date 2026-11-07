/** Who to tell when a module-level store changes: `subscribe` for useSyncExternalStore, `emit` after each change. */
export function signal() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    emit: () => listeners.forEach((f) => f()),
  };
}
