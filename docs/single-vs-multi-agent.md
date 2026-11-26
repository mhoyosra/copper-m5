# Single agent or multi-agent? (Module 4, Part 4)

_Fictional company, educational use. Numbers are from `evals/results/two-way-comparison.json`._

## The two designs

| | **Multi-agent** (what ships) | **Single agent** (built for this comparison) |
|---|---|---|
| Who talks to the customer | Ask Copper only | One support agent |
| Refund tools | Ask Copper has `submit_refund_request`; the **Refund Agent** (separate prompt, 6-step cap) has `lookup_order`, `check_refund_eligibility`, `issue_refund`, `escalate_to_supervisor` | The same four tools on the one agent, plus Ask Copper's tools and `get_refund_status`. No hand-off |
| Who supplies the request fields (item, reason, confirmation) | The code holds the request; the Refund Agent's tools take **no input** | The model fills them in when it calls `check_refund_eligibility` |
| Who finishes the job | Code (`finishReview`): fills skipped steps, escalates anything unfinished | The model, unless the optional safety net is on |
| What the customer reads | A code template (`statusText`) wrapped around a validated explanation | The model's own words, built from the tool results |

Both designs share the same rules engine, case records, limits and console. Switch with `ASK_COPPER_ARCH=single` (server-side only). Both are graded by the same golden set and judge: `npm run eval:compare`.

## What the evals showed (12 questions x 2 rounds, `gemini-3.1-flash-lite`)

| | Multi-agent | Single agent (no safety net) |
|---|---|---|
| `answer_correct` | 0.96 (23/24) | 0.88 (21/24) |
| `safe_and_honest` | 0.96 (23/24) | 1.00 (24/24) |
| Refund and safety questions only: correct / safe | 0.90 / 0.90 | 0.70 / 1.00 |
| Tool calls per answer | 0.83 | 1.12 |
| Tokens per answer | about 4,800 | about 5,400 |
| Cost per answer | $0.00144 | $0.00153 |
| Median time | 4.0 s | 2.3 s |

**Read these with care.** 24 answers per design is small, the judge is a model, and the misses are 1 and 3 answers. The cost and token gaps (about 6 to 12%) are real but small; time is dominated by rate-limit pauses. On this data **neither design is clearly better on average answer quality.**

## What mattered more than the averages

1. **The single agent skipped a step the customer could not see.** For the $149 Copper Home refund (the one case that needs a final `escalate_to_supervisor`), the single agent stopped after `check_refund_eligibility` in 2 of the 3 runs I observed. It still told the customer "a supervisor will review this", but the case stayed in `reviewing`, so **nobody was asked to review it**. The multi-agent design cannot do this: `finishReview` escalates any unfinished case in code. The LLM judge scored these answers as fine, because it reads text and cannot see case state. That is why the gate now also has an objective `case_resolved` check read from the case store.
2. **A new agent identity failed open.** The first version of the single agent used a new actor name, `support-agent`. `issueRefund` limited only the literal name `refund-agent` to auto-approved cases, so the new agent could have approved a $149 refund with no person involved. A test caught it before it ran; the guard now reads "anyone but the console". With more agents, permissions written as an allow-list of names are the risky kind.
3. **The model controls more in the single design.** It chooses the item, reason and confirmation that the rules run on. In the multi-agent design the Refund Agent cannot change them. Code still decides eligibility and amounts in both designs, so this widens the model's influence, not its authority.

## What I would ship

**Ship the multi-agent design**, for control reasons rather than quality ones. It costs about the same and answers about as well on this data, and it gives a customer-facing agent that has no money tool, tools that cannot be given a different order or amount, and a code-owned finish. Those structural guarantees are why it held up when the model skipped a step.

The simpler single agent is a reasonable alternative **if it keeps the fail-closed finish step** (`createSingleAgentRefund().finish`, on by default; `ASK_COPPER_SAFETY_NET=off` removes it for measurement). Most of the multi-agent design's advantage here came from code that finishes the job, not from having two prompts. Switch only after a larger run shows the single agent with the net matching on `case_resolved`, `safe_and_honest` and `answer_correct`.

## Not yet measured

- **Single agent with the safety net.** `npm run eval:compare` now runs three variants (multi, single without the net, single with it) but the free Gemini quota ran out before it could finish, so there is no result for the net yet.
- **More runs.** Use `EVAL_REPEATS=3` or more and a stronger model before trusting a difference of a few answers.
- **Why the single agent's round-2 refund answers were marked incorrect.** Its tool calls looked right and the replies I re-ran by hand were judged correct, so treat those three misses as run-to-run variance until a larger run says otherwise.
