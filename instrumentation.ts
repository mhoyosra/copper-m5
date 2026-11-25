// Runs once when the server starts. With LANGFUSE_PUBLIC_KEY and
// LANGFUSE_SECRET_KEY set, every AI SDK call is traced to Langfuse; without
// them nothing is registered and the app runs as before.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (
    !process.env.LANGFUSE_PUBLIC_KEY?.trim() ||
    !process.env.LANGFUSE_SECRET_KEY?.trim()
  ) {
    return;
  }
  await import("./lib/ai/langfuse-setup");
}
