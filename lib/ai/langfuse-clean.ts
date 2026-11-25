import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

export function maskEmails(value: unknown): unknown {
  if (typeof value === "string") return value.replace(EMAIL, "[email]");
  if (Array.isArray(value)) return value.map(maskEmails);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, maskEmails(item)]),
    );
  }
  return value;
}

// The AI SDK names spans after the model ("chat gemini-3.6-flash",
// "invoke_agent gemini-3.6-flash", "step 2"). Names are used for filters and
// evaluators, so they should say what the step does, not which model ran it
// or which iteration it was.
export function betterName(span: ReadableSpan): string {
  const { name, attributes } = span;
  if (name.startsWith("chat ")) return "generate-response";
  if (name.startsWith("invoke_agent")) {
    const agent = attributes["gen_ai.agent.name"];
    return typeof agent === "string" && agent ? agent : "agent-run";
  }
  if (/^step \d+$/.test(name)) return "agent-step";
  return name;
}

/** Cleans each span (customer emails masked, stable names) before Langfuse sees it. */
export class CleaningProcessor implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}

  onStart(span: Span, parentContext: Parameters<SpanProcessor["onStart"]>[1]) {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan) {
    // Attributes are read when the span is exported, so cleaning them here,
    // before the inner processor sees the span, is enough.
    const attributes = span.attributes as Record<string, unknown>;
    for (const [key, value] of Object.entries(attributes)) {
      attributes[key] = maskEmails(value);
    }
    (span as { name: string }).name = betterName(span);
    this.inner.onEnd(span);
  }

  forceFlush() {
    return this.inner.forceFlush();
  }

  shutdown() {
    return this.inner.shutdown();
  }
}
