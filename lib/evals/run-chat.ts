import { watchCalls } from "@/lib/ai/call";
import { askCopper } from "@/lib/copper/assistant/ask";
import type { ChatMessage } from "@/lib/copper/assistant/ask";
import { getStore, resetDemoStore } from "@/lib/copper/refunds/store";
import { toolCallsOf } from "@/lib/copper/assistant/progress";

/** Model calls made while answering one question. */
export type Usage = {
  /** Logged model calls: each agent run is one (plus embeddings for doc search). */
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Milliseconds from asking to the finished reply. */
  ms: number;
};

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
  usage: Usage;
  /** Cases for the order(s) named in the question that are still "reviewing"; null if no order was named. */
  stuckCases: number | null;
  /** Cases that ended approved (refunded or awaiting a return). The store is fresh per question, so these are this chat's. */
  approvedCases: number;
  status: string;
}> {
  // Total every model call made for this question (the chat agent, and the
  // Refund Agent when it is involved). Questions run one at a time.
  const usage: Usage = {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    ms: 0,
  };
  const started = performance.now();
  const stop = watchCalls((row) => {
    usage.modelCalls += 1;
    const add = (n: number | null) => (Number.isFinite(n) ? (n as number) : 0);
    usage.inputTokens += add(row.input_tokens);
    usage.outputTokens += add(row.output_tokens);
    usage.costUsd += add(row.cost_usd);
  });
  // Every question starts from the seed orders and no cases. Without this, a
  // refund asked in an earlier run is "already open" and later runs never take
  // the full path, which makes the scores depend on run order. Questions run
  // one at a time, so resetting here is safe.
  if (!resetDemoStore()) {
    throw new Error(
      "Evals need the in-memory refund store: unset SUPABASE_SERVICE_ROLE_KEY so they cannot touch real cases.",
    );
  }
  const { progress } = await askCopper({ messages, useTools: true, chatId });
  let chunk = await progress;
  let last = chunk.value;
  while (chunk.next) {
    chunk = await chunk.next;
    last = chunk.value;
  }
  stop();
  // An objective check the judge can't make: a refund chat must not leave a
  // case unfinished, whatever the reply says.
  const orderIds = [
    ...new Set(
      messages
        .map((m) => m.content)
        .join(" ")
        .match(/CSL-\d+/g) ?? [],
    ),
  ];
  // Money moved, or a return was approved, during this chat.
  const approvedCases = (
    await getStore().listCases(["refunded", "awaiting_return"])
  ).length;
  let stuckCases: number | null = null;
  if (orderIds.length > 0) {
    const store = getStore();
    const cases = (
      await Promise.all(orderIds.map((id) => store.casesForOrder(id)))
    ).flat();
    stuckCases = cases.filter((c) => c.status === "reviewing").length;
  }
  usage.ms = Math.round(performance.now() - started);
  return {
    usage,
    stuckCases,
    approvedCases,
    reply: last.reply,
    status: last.status,
    toolsCalled: toolCallsOf(last).map((call) => call.name),
    toolResults: toolCallsOf(last)
      .filter((call) => call.output !== undefined)
      .map((call) => ({ name: call.name, output: shorten(call.output) })),
  };
}
