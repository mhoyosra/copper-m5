// npm run eval:compare: runs the same golden questions and the same judge
// against three designs and prints quality, safety, unfinished cases, cost and
// time side by side:
//   multi         Ask Copper hands refunds to the Refund Agent (the shipped design)
//   single-bare   one agent with every tool, no hand-off, no safety net
//   single-net    the same single agent plus the fail-closed finish step
// Writes evals/results/architecture-comparison.json.
// Set EVAL_REPEATS=2 to run each design twice (answers vary between runs).
import "@/lib/ai/langfuse-setup";
import { mkdirSync, writeFileSync } from "node:fs";
import { LangfuseClient } from "@langfuse/client";
import { flushTraces } from "@/lib/ai/langfuse";
import { buildConfig } from "../experiments/ask-copper-gate";
import type { Usage } from "@/lib/evals/run-chat";

const VARIANTS = {
  multi: { ASK_COPPER_ARCH: "multi", ASK_COPPER_SAFETY_NET: "on" },
  "single-bare": { ASK_COPPER_ARCH: "single", ASK_COPPER_SAFETY_NET: "off" },
  "single-net": { ASK_COPPER_ARCH: "single", ASK_COPPER_SAFETY_NET: "on" },
} as const;
type Variant = keyof typeof VARIANTS;
const names = Object.keys(VARIANTS) as Variant[];

type Row = {
  question: string;
  correct: number;
  safe: number;
  /** NaN when the question names no order (nothing to resolve). */
  resolved: number;
  tools: string[];
  usage: Usage;
};

const dataset = process.env.EVAL_DATASET ?? "ask-copper-golden";
const repeats = Number(process.env.EVAL_REPEATS ?? 1);
const only = process.env.EVAL_VARIANTS?.split(",") as Variant[] | undefined;
const langfuse = new LangfuseClient();
const set = await langfuse.dataset.get(dataset);
const stamp = new Date().toISOString().slice(0, 16);

const results = Object.fromEntries(
  names.map((n) => [n, [] as Row[]]),
) as Record<Variant, Row[]>;
const failedItems = Object.fromEntries(names.map((n) => [n, 0])) as Record<
  Variant,
  number
>;

for (let round = 1; round <= repeats; round++) {
  for (const variant of only ?? names) {
    Object.assign(process.env, VARIANTS[variant]);
    console.log(`Running ${variant} (round ${round}/${repeats})…`);
    const result = await set.runExperiment({
      ...buildConfig(),
      runName: `compare ${variant} r${round} ${stamp}`,
    });
    // Items whose chat or judge call failed are missing from the results.
    failedItems[variant] += set.items.length - result.itemResults.length;
    for (const item of result.itemResults) {
      const out = item.output as { toolsCalled: string[]; usage: Usage } | null;
      const score = (name: string) =>
        Number(item.evaluations.find((e) => e.name === name)?.value ?? NaN);
      const input = (item.input ?? item.item?.input) as {
        messages: { content: string }[];
      };
      results[variant].push({
        question: input.messages.at(-1)?.content ?? "",
        correct: score("answer_correct"),
        safe: score("safe_and_honest"),
        resolved: score("case_resolved"),
        tools: out?.toolsCalled ?? [],
        usage: out?.usage ?? {
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          ms: 0,
        },
      });
    }
  }
}

const finite = (xs: number[]) => xs.filter(Number.isFinite);
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const summary = (rows: Row[]) => ({
  answers: rows.length,
  answerCorrect: mean(finite(rows.map((r) => r.correct))),
  safeAndHonest: mean(finite(rows.map((r) => r.safe))),
  caseResolved: mean(finite(rows.map((r) => r.resolved))),
  agentRunsPerAnswer: mean(rows.map((r) => r.usage.modelCalls)),
  toolCallsPerAnswer: mean(rows.map((r) => r.tools.length)),
  tokensPerAnswer: mean(
    rows.map((r) => r.usage.inputTokens + r.usage.outputTokens),
  ),
  costUsdPerAnswer: mean(rows.map((r) => r.usage.costUsd)),
  medianSeconds: median(rows.map((r) => r.usage.ms / 1000)),
});

const ran = (only ?? names) as Variant[];
const table = Object.fromEntries(ran.map((n) => [n, summary(results[n])]));
console.log("All questions:");
console.table(table);
console.log(
  "Items that failed to run (infrastructure, not quality):",
  failedItems,
);

const refundWords = /refund|CSL-/i;
const refundOnly = Object.fromEntries(
  ran.map((n) => [
    n,
    summary(results[n].filter((r) => refundWords.test(r.question))),
  ]),
);
console.log("Refund and safety questions only:");
console.table(refundOnly);

for (const n of ran) {
  const bad = results[n].filter(
    (r) => r.correct === 0 || r.safe === 0 || r.resolved === 0,
  );
  for (const r of bad) {
    console.log(
      `${n}: ${r.question.slice(0, 60)} (correct=${r.correct}, safe=${r.safe}, resolved=${r.resolved}) tools=${r.tools.join(">")}`,
    );
  }
}

mkdirSync("evals/results", { recursive: true });
writeFileSync(
  "evals/results/architecture-comparison.json",
  `${JSON.stringify({ stamp, dataset, repeats, table, refundOnly, failedItems, results }, null, 2)}\n`,
);
await langfuse.flush();
await flushTraces();
process.exit(0);
