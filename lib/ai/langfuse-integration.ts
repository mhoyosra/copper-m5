import { registerTelemetry } from "ai";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";

declare global {
  var __langfuseAiIntegrationRegistered: boolean | undefined;
}

/**
 * Tells the AI SDK to emit Langfuse-shaped spans (a generation per model step,
 * a tool observation per tool call). Safe to call more than once. It needs an
 * OpenTelemetry provider with the Langfuse span processor to export them: the
 * app registers one in langfuse-setup.ts, and the CI experiment action sets
 * up its own.
 */
export function registerAiTracing() {
  if (globalThis.__langfuseAiIntegrationRegistered) return;
  globalThis.__langfuseAiIntegrationRegistered = true;
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
}
