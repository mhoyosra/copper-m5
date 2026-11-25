import { context, trace } from "@opentelemetry/api";
import { propagateAttributes, startObservation } from "@langfuse/tracing";

// Helpers for the Langfuse trace around one chat turn. All of them do nothing
// when tracing is off (no keys), because OpenTelemetry's default is a no-op.

/** Sends any waiting spans now; a serverless function may stop right after it replies. */
export async function flushTraces(): Promise<void> {
  try {
    await globalThis.__langfuseSpanProcessor?.forceFlush();
  } catch {
    // Tracing must never break the chat.
  }
}

type Root = ReturnType<typeof startObservation>;

/**
 * Runs `fn` inside a root observation for one chat turn: one trace per turn,
 * grouped into a session by the chat id. `fn` ends the observation (with the
 * reply as its output) when the reply has finished streaming.
 */
export function inChatTrace<T>(
  info: {
    name: string;
    sessionId?: string;
    input?: unknown;
    tags?: string[];
    metadata?: Record<string, string>;
  },
  fn: (root: Root) => T,
): T {
  const root = startObservation(
    info.name,
    { input: info.input },
    { asType: "agent" },
  );
  return context.with(trace.setSpan(context.active(), root.otelSpan), () =>
    propagateAttributes(
      {
        traceName: info.name,
        sessionId: info.sessionId,
        tags: info.tags,
        metadata: info.metadata,
      },
      () => fn(root),
    ),
  );
}
