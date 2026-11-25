import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A fake Langfuse that records what was sent.
const events: { kind: string; body: Record<string, unknown> }[] = [];
function handle(kind: string, body: Record<string, unknown>) {
  events.push({ kind, body });
  return {
    span: (b: Record<string, unknown>) => handle("span", b),
    generation: (b: Record<string, unknown>) => handle("generation", b),
    update: (b: Record<string, unknown>) =>
      events.push({ kind: "update", body: b }),
    end: (b?: Record<string, unknown>) =>
      events.push({ kind: `${kind}-end`, body: b ?? {} }),
  };
}
vi.mock("langfuse", () => ({
  default: class {
    trace = (b: Record<string, unknown>) => handle("trace", b);
    flushAsync = async () => {};
  },
}));

import {
  resetTracing,
  scrub,
  startGeneration,
  traceTools,
  withChatTrace,
} from "@/lib/ai/trace";

describe("Langfuse tracing", () => {
  beforeEach(() => {
    events.length = 0;
    resetTracing();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetTracing();
  });

  it("does nothing without keys", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "");
    expect(startGeneration({ agent: "a", module: 4, model: "m" })).toBeNull();
    const tools = { t: { execute: async () => 1 } };
    expect(traceTools(tools)).toBe(tools);
    await withChatTrace({ name: "x" }, async () => {});
    expect(events).toHaveLength(0);
  });

  it("records the agent, tokens, cost and tool spans under one trace", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    await withChatTrace({ name: "chat", chatId: "c1" }, async () => {
      const tools = traceTools({
        lookup: { execute: async (n: number) => n + 1 },
      });
      const gen = startGeneration({
        agent: "refund-agent",
        module: 4,
        model: "google/gemini-3-flash",
        input: "hi bob@example.com",
      });
      expect(await tools.lookup.execute(1)).toBe(2);
      gen?.end({
        ok: true,
        usage: { inputTokens: 10, outputTokens: 5 },
        costUsd: 0.001,
        output: "done",
      });
    });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual([
      "trace",
      "generation",
      "span",
      "span-end",
      "generation-end",
    ]);
    expect(events[0].body.sessionId).toBe("c1");
    expect(events[1].body.name).toBe("refund-agent");
    expect(JSON.stringify(events[1].body.input)).not.toContain("bob@");
    expect(events[2].body.name).toBe("tool:lookup");
    expect(events[4].body.usageDetails).toEqual({
      input: 10,
      output: 5,
      total: 15,
    });
    expect(events[4].body.costDetails).toEqual({ total: 0.001 });
  });

  it("marks a failed tool as an error and rethrows", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    await withChatTrace({ name: "chat" }, async () => {
      const tools = traceTools({
        boom: {
          execute: async () => {
            throw new Error("nope");
          },
        },
      });
      await expect(tools.boom.execute()).rejects.toThrow("nope");
    });
    expect(events.at(-1)?.body.level).toBe("ERROR");
  });

  it("masks emails", () => {
    expect(scrub({ a: "x@y.com" })).toEqual({ a: "[email]" });
  });
});
