"use server";

// The server action the Ask Copper chat calls. It streams the conversation to
// the model through callStream (lib/ai/call.ts), with or without the tools,
// and sends back each step as it happens, so the panel can show Copper
// thinking and using its tools.
import { stepCountIs } from "ai";
import { after } from "next/server";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { flushTraces, inChatTrace } from "@/lib/ai/langfuse";
import { createLive, type Live } from "@/lib/ai/live";
import {
  describeAiError,
  GENERIC_MESSAGE,
} from "@/lib/copper/assistant/errors";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type { Progress, ToolStep } from "@/lib/copper/assistant/progress";
import { copperTools } from "@/lib/copper/assistant/tools";
import { createRefundSupportTools } from "@/lib/copper/refunds/support-tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
  /** One per open chat. Refund lookups that fail are counted against it. */
  chatId?: string;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per question. */
const MAX_STEPS = 5;

const SORRY = GENERIC_MESSAGE;

export async function askCopper(
  request: AskCopperRequest,
): Promise<AskCopperResult> {
  // One Langfuse trace per question, grouped into a session by the chat id.
  // Ask Copper's model steps and tool calls (and the Refund Agent's, when a
  // refund is requested) are recorded under it. A no-op without Langfuse keys.
  return inChatTrace(
    {
      name: "ask-copper-chat",
      sessionId: request.chatId,
      input: request.messages.at(-1)?.content,
      tags: [request.useTools ? "with-tools" : "no-tools"],
      metadata: { agent: "ask-copper" },
    },
    (root) => runAskCopper(request, root),
  );
}

async function runAskCopper(
  { messages, useTools, chatId }: AskCopperRequest,
  root: { update(body: { output?: unknown }): { end(): void } },
): Promise<AskCopperResult> {
  const { live, update, done } = createLive<Progress>();
  const progress: Progress = { steps: [], reply: "", status: "working" };
  // A fresh copy each time, so earlier updates never change underneath the
  // panel.
  const snapshot = (): Progress => ({
    ...progress,
    steps: progress.steps.map((step) => ({ ...step })),
  });
  const toolStep = (id: string) =>
    progress.steps.find(
      (step): step is ToolStep => step.type === "tool" && step.id === id,
    );

  // Without tools, send no instructions either: "always use your tools" with
  // no tools makes the model answer with nothing.
  const result = callStream(
    { module: 2, feature: "ask-copper" },
    {
      messages,
      providerOptions: THOUGHT_SUMMARIES,
      ...(useTools && {
        instructions: COPPER_INSTRUCTIONS,
        // Ask Copper's own tools, plus the two refund tools from Module 4.
        tools: {
          ...copperTools,
          ...createRefundSupportTools({ chatId: chatId ?? "anonymous" }),
        },
        stopWhen: stepCountIs(MAX_STEPS),
      }),
    },
  );

  // Send the trace before a serverless function stops, once the reply is done.
  try {
    after(flushTraces);
  } catch {
    // Not inside a request (tests, scripts): nothing to wait for.
  }

  // Read the stream in the background, so the panel gets the first update now.
  void (async () => {
    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "reasoning-delta": {
            const last = progress.steps.at(-1);
            if (last?.type === "thinking") last.text += part.text;
            else progress.steps.push({ type: "thinking", text: part.text });
            break;
          }
          case "tool-input-start":
            progress.steps.push({
              type: "tool",
              id: part.id,
              name: part.toolName,
              state: "calling",
            });
            break;
          case "tool-call": {
            const step = toolStep(part.toolCallId);
            if (step) step.input = part.input;
            else
              progress.steps.push({
                type: "tool",
                id: part.toolCallId,
                name: part.toolName,
                state: "calling",
                input: part.input,
              });
            break;
          }
          case "tool-result": {
            const step = toolStep(part.toolCallId);
            if (step)
              Object.assign(step, { output: part.output, state: "done" });
            break;
          }
          case "tool-error": {
            const step = toolStep(part.toolCallId);
            const message =
              part.error instanceof Error
                ? part.error.message
                : String(part.error);
            if (step) Object.assign(step, { output: message, state: "error" });
            break;
          }
          case "text-delta":
            progress.reply += part.text;
            break;
          case "error":
            throw part.error;
          default:
            continue;
        }
        update(snapshot());
      }
      progress.status = "done";
      if (!progress.reply.trim()) progress.reply = SORRY;
    } catch (error) {
      progress.status = "error";
      // Say what went wrong when we can tell (quota used up, service busy).
      if (!progress.reply.trim()) progress.reply = describeAiError(error);
    }
    root.update({ output: progress.reply }).end();
    done(snapshot());
  })();

  return { progress: live };
}
