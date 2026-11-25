import { describe, expect, it, vi } from "vitest";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import {
  betterName,
  CleaningProcessor,
  maskEmails,
} from "@/lib/ai/langfuse-clean";

const span = (name: string, attributes: Record<string, unknown> = {}) =>
  ({ name, attributes }) as unknown as ReadableSpan;

describe("Langfuse span cleaning", () => {
  it("masks emails in strings, arrays and objects", () => {
    expect(
      maskEmails({ a: "mail ada@example.com now", b: ["x@y.org"], c: 3 }),
    ).toEqual({ a: "mail [email] now", b: ["[email]"], c: 3 });
  });

  it("names spans for what they do, not the model or the iteration", () => {
    expect(betterName(span("chat gemini-3.6-flash"))).toBe("generate-response");
    expect(
      betterName(
        span("invoke_agent gemini-3.6-flash", {
          "gen_ai.agent.name": "refund-agent",
        }),
      ),
    ).toBe("refund-agent");
    expect(betterName(span("invoke_agent gemini-3.6-flash"))).toBe("agent-run");
    expect(betterName(span("step 4"))).toBe("agent-step");
    expect(betterName(span("get_prices"))).toBe("get_prices");
  });

  it("cleans a span before the Langfuse processor gets it", () => {
    const inner = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      forceFlush: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
    };
    const processor = new CleaningProcessor(inner);
    const s = span("chat gemini-3.6-flash", {
      "gen_ai.input.messages": '{"email":"ada@example.com"}',
    });
    processor.onEnd(s);
    expect(inner.onEnd).toHaveBeenCalledWith(s);
    expect(s.name).toBe("generate-response");
    expect(s.attributes["gen_ai.input.messages"]).toBe('{"email":"[email]"}');
  });
});
