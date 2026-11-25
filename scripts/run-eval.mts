// npm run eval:run: the same quality gate CI runs, from your machine. Prints
// each answer's scores and the run-level averages; scores also land in Langfuse
// on a dataset run you can compare. Exits 1 when the gate fails.
import "@/lib/ai/langfuse-setup";
import { LangfuseClient, RegressionError } from "@langfuse/client";
import { flushTraces } from "@/lib/ai/langfuse";
import { checkGate, config } from "../experiments/ask-copper-gate";

const dataset = process.env.EVAL_DATASET ?? "ask-copper-golden";
const langfuse = new LangfuseClient();
const set = await langfuse.dataset.get(dataset);
const result = await set.runExperiment({
  ...config,
  runName: `local ${new Date().toISOString().slice(0, 16)}`,
});
console.log(await result.format({ includeItemResults: true }));

let code = 0;
try {
  checkGate(result);
  console.log("GATE: pass");
} catch (error) {
  code = 1;
  console.log(
    error instanceof RegressionError
      ? `GATE: FAIL (${error.metric} = ${error.value}, needs ${error.threshold})`
      : `GATE: ERROR ${String(error)}`,
  );
}
await langfuse.flush();
await flushTraces();
process.exit(code);
