import { AsyncLocalStorage } from "node:async_hooks";
import Langfuse from "langfuse";

// Langfuse tracing. One trace per chat turn; inside it, one generation per
// agent call (which agent, model, tokens, cost, time) and one span per tool.
// A tool that runs another agent (submit_refund_request) nests that agent's
// generation and tools under its own span. Everything is a no-op until
// LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set, so the app still runs
// with no environment variables.

// The slice of a Langfuse trace/span that we use, so tests can fake it.
export type Node = {
  span(body: Record<string, unknown>): Handle;
  generation(body: Record<string, unknown>): Handle;
  update(body: Record<string, unknown>): unknown;
};
export type Handle = Node & { end(body?: Record<string, unknown>): unknown };

type Store = { parent: Node };
const storage = new AsyncLocalStorage<Store>();

let client: Langfuse | null | undefined;

export function tracingClient(): Langfuse | null {
  if (client !== undefined) return client;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  client =
    publicKey && secretKey
      ? new Langfuse({
          publicKey,
          secretKey,
          baseUrl:
            process.env.LANGFUSE_BASE_URL?.trim() ||
            "https://cloud.langfuse.com",
        })
      : null;
  return client;
}

/** For tests: forget the cached client so the environment is read again. */
export function resetTracing() {
  client = undefined;
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

/** Copies a value for Langfuse with customer emails masked and long text cut. */
export function scrub(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const text = JSON.stringify(value)?.replace(EMAIL, "[email]");
    if (text === undefined) return undefined;
    const parsed: unknown = JSON.parse(text);
    return text.length > 8000
      ? `${text.slice(0, 8000)}… (cut, ${text.length} characters)`
      : parsed;
  } catch {
    return String(value).replace(EMAIL, "[email]");
  }
}

/** Starts a trace for one chat turn and runs `fn` inside it. */
export async function withChatTrace<T>(
  info: { name: string; chatId?: string; input?: unknown; tags?: string[] },
  fn: () => Promise<T>,
): Promise<T> {
  const lf = tracingClient();
  if (!lf) return fn();
  const trace = lf.trace({
    name: info.name,
    sessionId: info.chatId,
    input: scrub(info.input),
    tags: info.tags,
  }) as unknown as Node;
  return storage.run({ parent: trace }, fn);
}

export type Usage = { inputTokens?: number; outputTokens?: number };

/** Starts a generation (one agent call) under the current trace or tool. */
export function startGeneration(info: {
  agent: string;
  module: number;
  model: string;
  input?: unknown;
}) {
  const lf = tracingClient();
  if (!lf) return null;
  const parent: Node =
    storage.getStore()?.parent ??
    (lf.trace({
      name: info.agent,
      tags: [info.agent],
    }) as unknown as Node);
  const generation = parent.generation({
    name: info.agent,
    model: info.model,
    input: scrub(info.input),
    startTime: new Date(),
    metadata: { agent: info.agent, module: info.module },
  });
  return {
    end(result: {
      ok: boolean;
      usage?: Usage;
      costUsd?: number | null;
      output?: unknown;
      error?: unknown;
    }) {
      const input = result.usage?.inputTokens;
      const output = result.usage?.outputTokens;
      generation.end({
        output: scrub(result.output),
        ...(input !== undefined &&
          output !== undefined && {
            usageDetails: { input, output, total: input + output },
          }),
        ...(typeof result.costUsd === "number" && {
          costDetails: { total: result.costUsd },
        }),
        ...(!result.ok && {
          level: "ERROR",
          statusMessage:
            result.error instanceof Error
              ? result.error.message
              : String(result.error ?? "failed"),
        }),
      });
    },
  };
}

type Executable = { execute?: (input: never, options: never) => unknown };

/** Wraps each tool's execute so it shows up as a span with its input, output and time. */
export function traceTools<T extends Record<string, unknown> | undefined>(
  tools: T,
): T {
  if (!tools || !tracingClient()) return tools;
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const original = (definition as Executable).execute;
      if (typeof original !== "function") return [name, definition];
      return [
        name,
        {
          ...(definition as object),
          execute: async (input: never, options: never) => {
            const parent = storage.getStore()?.parent;
            if (!parent) return original(input, options);
            const span = parent.span({
              name: `tool:${name}`,
              input: scrub(input),
              startTime: new Date(),
            });
            try {
              const output = await storage.run({ parent: span }, async () =>
                original(input, options),
              );
              span.end({ output: scrub(output) });
              return output;
            } catch (error) {
              span.end({
                level: "ERROR",
                statusMessage:
                  error instanceof Error ? error.message : String(error),
              });
              throw error;
            }
          },
        },
      ];
    }),
  ) as T;
}

/** Sets the trace's final output, then sends everything to Langfuse. */
export async function finishChatTrace(output?: unknown) {
  const lf = tracingClient();
  if (!lf) return;
  try {
    const parent = storage.getStore()?.parent;
    if (parent && output !== undefined)
      parent.update({ output: scrub(output) });
    await lf.flushAsync();
  } catch {
    // Tracing must never break the chat.
  }
}
