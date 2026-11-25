import { askCopper } from "@/lib/copper/assistant/ask";
import type { ChatMessage } from "@/lib/copper/assistant/ask";

/** One whole Ask Copper turn, read to the end: the reply and the tools it called. */
export async function runChat(
  messages: ChatMessage[],
  chatId: string,
): Promise<{ reply: string; toolsCalled: string[]; status: string }> {
  const { progress } = await askCopper({ messages, useTools: true, chatId });
  let chunk = await progress;
  let last = chunk.value;
  while (chunk.next) {
    chunk = await chunk.next;
    last = chunk.value;
  }
  return {
    reply: last.reply,
    status: last.status,
    toolsCalled: last.steps.flatMap((step) =>
      step.type === "tool" ? [step.name] : [],
    ),
  };
}
