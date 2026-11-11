// Runs once as the server starts, so once each time the app opens; `app:dev` is left out.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { sendOpen } = await import("@/lib/server/telemetry");
  void sendOpen();
}
