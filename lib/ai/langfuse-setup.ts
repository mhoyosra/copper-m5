import { registerTelemetry } from "ai";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { CleaningProcessor, maskEmails } from "@/lib/ai/langfuse-clean";

// Langfuse tracing for the AI SDK
// (https://langfuse.com/integrations/frameworks/vercel-ai-sdk).
// The span processor sends spans to Langfuse; the integration turns each model
// step into a generation and each tool call into a tool observation, with
// model, tokens, cost and timing. Registered from instrumentation.ts only when
// Langfuse keys are set.

declare global {
  var __langfuseSpanProcessor: SpanProcessor | undefined;
}

if (!globalThis.__langfuseSpanProcessor) {
  const processor = new CleaningProcessor(
    new LangfuseSpanProcessor({ mask: ({ data }) => maskEmails(data) }),
  );
  globalThis.__langfuseSpanProcessor = processor;
  new NodeSDK({ spanProcessors: [processor] }).start();
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
}
