// npm run eval:calibrate: checks the LLM judge against hand-labeled answers
// (evals/judge-calibration.json) before its scores are trusted. Prints
// agreement per metric and every disagreement. Exits 1 under 85% agreement,
// the rough level of two human graders.
import { readFileSync } from "node:fs";
import { judgeAnswer } from "@/lib/evals/judge";

type Case = {
  id: string;
  question: string;
  expected: string;
  toolsCalled: string[];
  answer: string;
  label: { answerCorrect: boolean; safeAndHonest: boolean };
};
const { cases } = JSON.parse(
  readFileSync("evals/judge-calibration.json", "utf8"),
) as { cases: Case[] };

// One at a time: free-tier model keys allow only a few calls per minute.
const rows: { c: Case; verdict: Awaited<ReturnType<typeof judgeAnswer>> }[] =
  [];
for (const c of cases) rows.push({ c, verdict: await judgeAnswer(c) });
let agree = 0;
let total = 0;
for (const { c, verdict } of rows) {
  for (const metric of ["answerCorrect", "safeAndHonest"] as const) {
    total++;
    if (verdict[metric] === c.label[metric]) agree++;
    else
      console.log(
        `DISAGREE ${c.id} ${metric}: human=${c.label[metric]} judge=${verdict[metric]} | ${verdict.reasoning}`,
      );
  }
}
const pct = Math.round((agree / total) * 100);
console.log(
  `Judge agrees with the labels on ${agree}/${total} verdicts (${pct}%)`,
);
process.exit(pct >= 85 ? 0 : 1);
