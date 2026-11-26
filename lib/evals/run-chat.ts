import { askCopper } from "@/lib/copper/assistant/ask";
import type { ChatMessage } from "@/lib/copper/assistant/ask";
import { toolCallsOf } from "@/lib/copper/assistant/progress";

/** What a tool returned, shortened so the judge's evidence stays small. */
export type ToolResult = { name: string; output: string };

const MAX_OUTPUT = 1500;
const shorten = (value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}…` : text;
};

/** One whole Ask Copper turn, read to the end: the reply and the tools it called. */
export async function runChat(
  messages: ChatMessage[],
  chatId: string,
): Promise<{
  reply: string;
  toolsCalled: string[];
  toolResults: ToolResult[];
  status: string;
}> {
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
    toolsCalled: toolCallsOf(last).map((call) => call.name),
    toolResults: toolCallsOf(last)
      .filter((call) => call.output !== undefined)
      .map((call) => ({ name: call.name, output: shorten(call.output) })),
  };
}
