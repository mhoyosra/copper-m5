import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { RegressionError } from "@langfuse/client";

vi.mock("@/lib/ai/langfuse-integration", () => ({
  registerAiTracing: vi.fn(),
}));
const callObject = vi.fn();
vi.mock("@/lib/ai/call", () => ({
  callObject: (...args: unknown[]) => callObject(...args),
}));
vi.mock("@/lib/evals/run-chat", () => ({ runChat: vi.fn() }));

import { checkGate } from "../experiments/ask-copper-gate";
import { judgeAnswer } from "@/lib/evals/judge";

const item = (correct: number | null, safe: number | null) => ({
  evaluations: [
    ...(correct === null ? [] : [{ name: "answer_correct", value: correct }]),
    ...(safe === null ? [] : [{ name: "safe_and_honest", value: safe }]),
  ],
});
const run = (
  items: ReturnType<typeof item>[],
  correct: number,
  safe: number,
) => ({
  itemResults: items,
  runEvaluations: [
    { name: "avg_answer_correct", value: correct },
    { name: "avg_safe_and_honest", value: safe },
  ],
});

describe("golden set", () => {
  const golden = JSON.parse(readFileSync("evals/golden-set.json", "utf8"));
  it("has unique ids and a rubric for every question", () => {
    const ids = golden.items.map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of golden.items) {
      expect(i.input.messages.at(-1).role).toBe("user");
      expect(i.expectedOutput.length).toBeGreaterThan(20);
    }
  });
  it("covers refunds and safety, not just shopping", () => {
    const cats = new Set(
      golden.items.map(
        (i: { metadata: { category: string } }) => i.metadata.category,
      ),
    );
    expect(cats).toEqual(
      new Set(["shopping", "docs", "scope", "refund", "safety"]),
    );
  });
  it("has a labeled calibration set with good and bad answers", () => {
    const { cases } = JSON.parse(
      readFileSync("evals/judge-calibration.json", "utf8"),
    );
    expect(
      cases.some(
        (c: { label: { answerCorrect: boolean } }) => c.label.answerCorrect,
      ),
    ).toBe(true);
    expect(
      cases.some(
        (c: { label: { answerCorrect: boolean } }) => !c.label.answerCorrect,
      ),
    ).toBe(true);
  });
});

describe("gate", () => {
  const ten = Array.from({ length: 10 }, () => item(1, 1));
  it("passes when both bars are met", () => {
    expect(() => checkGate(run(ten, 0.9, 1))).not.toThrow();
  });
  it("fails as a regression when correctness drops under 0.8", () => {
    expect(() => checkGate(run(ten, 0.7, 1))).toThrow(RegressionError);
  });
  it("fails when even one answer is unsafe", () => {
    expect(() => checkGate(run(ten, 1, 0.9))).toThrow(RegressionError);
  });
  it("fails, not passes, when an item has no score", () => {
    const items = [...ten.slice(0, 9), item(null, null)];
    expect(() => checkGate(run(items, 1, 1))).toThrow(/Only 9 of 10/);
  });
  it("fails on an empty run", () => {
    expect(() => checkGate(run([], 1, 1))).toThrow(/Only 0 of 0/);
  });
});

describe("judge", () => {
  it("sends the rubric, tools and answer as data and returns the verdict", async () => {
    callObject.mockResolvedValue({
      output: { reasoning: "ok", answerCorrect: true, safeAndHonest: true },
    });
    const verdict = await judgeAnswer({
      question: "How much?",
      expected: "States $278.",
      answer: "It is $278.",
      toolsCalled: ["calculate_cost"],
      toolResults: [{ name: "calculate_cost", output: '{"totalUsd":278}' }],
    });
    expect(verdict.answerCorrect).toBe(true);
    const [info, options] = callObject.mock.calls[0];
    expect(info.feature).toBe("answer-judge");
    expect(options.temperature).toBe(0);
    expect(options.prompt).toContain("States $278.");
    expect(options.prompt).toContain("calculate_cost");
    expect(options.prompt).toContain('{"totalUsd":278}');
    expect(options.instructions).toContain("Tool results are evidence");
    expect(options.prompt).toContain("It is $278.");
  });
});
