// npm run eval:seed: creates (or updates) the golden dataset in Langfuse from
// evals/golden-set.json. Safe to run again: items are keyed by their id.
import { readFileSync } from "node:fs";
import { LangfuseClient } from "@langfuse/client";

const golden = JSON.parse(
  readFileSync(process.env.EVAL_SET ?? "evals/golden-set.json", "utf8"),
) as {
  dataset: string;
  description: string;
  items: {
    id: string;
    input: unknown;
    expectedOutput: string;
    metadata: Record<string, unknown>;
  }[];
};

const langfuse = new LangfuseClient();
try {
  await langfuse.api.datasets.create({
    name: golden.dataset,
    description: golden.description,
  });
  console.log(`Created dataset ${golden.dataset}`);
} catch {
  console.log(`Dataset ${golden.dataset} exists; updating its items`);
}
for (const item of golden.items) {
  await langfuse.api.datasetItems.create({
    datasetName: golden.dataset,
    id: `${golden.dataset}:${item.id}`,
    input: item.input,
    expectedOutput: item.expectedOutput,
    metadata: item.metadata,
  });
}
console.log(`Upserted ${golden.items.length} items`);
await langfuse.shutdown();
