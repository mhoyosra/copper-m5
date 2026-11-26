# Single agent or multi-agent? (Module 4, Part 4)

_Fictional company, educational use. Numbers are from `evals/results/architecture-comparison.json`
(`npm run eval:compare`)._

## The designs

| | **Multi-agent** (what ships) | **Single agent** (built for this comparison) |
|---|---|---|
| Who talks to the customer | Ask Copper only | One support agent |
| Refund tools | Ask Copper has `submit_refund_request`; the **Refund Agent** (own prompt, 6-step cap) has `lookup_order`, `check_refund_eligibility`, `issue_refund`, `escalate_to_supervisor` | The same four tools on the one agent, plus Ask Copper's tools and `get_refund_status`. No hand-off |
| Who supplies the request fields (item, reason, confirmation) | The code holds the request; the Refund Agent's tools take **no input** | The model fills them in when it calls `check_refund_eligibility` |
| Who finishes the job | Code (`finishReview`): fills skipped steps, escalates anything unfinished | The model, plus an optional fail-closed finish step (`ASK_COPPER_SAFETY_NET`, on by default) |
| What the customer reads | A code template (`statusText`) around a validated explanation | The model's own words, built from tool results that include `statusText` |

Both designs share the rules engine, case records, limits, console, golden set and judge. Switch with
`ASK_COPPER_ARCH=single` (server-side only). Three variants were graded: **multi**, **single-bare**
(no finish step) and **single-net** (with it).

## Results: 12 golden questions x 3 rounds each, `gemini-3.1-flash-lite` for chat and judge

Every question starts from a fresh in-memory store, and no item failed to run.

| 36 answers per variant | Multi-agent | Single, bare | Single + net |
|---|---|---|---|
| `answer_correct` (judge) | 0.97 | 0.97 | 1.00 |
| `safe_and_honest` (judge) | 1.00 | 1.00 | 1.00 |
| `case_resolved` (code check on the case store) | 1.00 | 1.00 | 1.00 |
| Tokens per answer | about 4,800 | about 5,600 (+16%) | about 5,700 (+19%) |
| Cost per answer | $0.00146 | $0.00160 (+10%) | $0.00164 (+12%) |
| Median time, all questions | 1.8 s | 1.8 s | 1.9 s |
| Median time, 5 refund and safety questions | 4.1 s | 2.6 s | 2.8 s |

The one miss for multi-agent and for single-bare was the same shopping question (the Home plus Notes
total); single + net got it right. That is one answer in 36 and is noise.

**What the evals show:** on these 12 questions the designs are tied on quality, safety and unfinished
cases. The single agent used the full refund path correctly every time (it called
`escalate_to_supervisor` in 3 of 3 runs, so the safety net never had work to do). The measurable
differences are cost and speed: the single agent costs about 10% more per answer, because it carries the
refund tools and instructions in every conversation, including shopping questions, and it is about 35%
faster on refund questions, because it skips one agent run.

**What the evals cannot show:** 36 answers and 12 questions cannot separate designs that are both near
the ceiling. The golden set has only one injection attempt and one limit-leak question, and neither
design failed either. These results say nothing about rare failures, which is where the designs differ.

## Differences that did not show up in the scores

1. **A new agent identity failed open (found by a test, now fixed).** The first single agent used a new
   actor name, `support-agent`. `issueRefund` limited only the literal name `refund-agent` to
   auto-approved cases, so the new agent could have approved a $149 refund with no person involved. The
   guard now reads "anyone but the console". Permissions written as an allow-list of names fail open
   when you add agents.
2. **The model controls more in the single design.** It chooses the item, reason and confirmation that
   the rules run on; in the multi-agent design the Refund Agent cannot change them. Code still decides
   eligibility and amounts in both, so this widens the model's influence, not its authority.
3. **Refund tools sit in every conversation.** In the single design a shopping chat, and any injected
   instruction in it, can reach the refund tools. In the multi-agent design the customer-facing agent has
   no money tool at all.
4. **Fail-closed finishing is code in one design and a model's habit in the other.** The multi-agent
   wrapper escalates an unfinished case no matter what the model does. The single agent needs the added
   finish step to match, and my evals only showed it unneeded because the model happened to do every
   step.

## What I would ship

**Multi-agent, with moderate confidence.** The scores do not favor it. The reasons are cost (about 10%
cheaper per answer here) and structure: no money tool on the customer-facing agent, input-less refund
tools, a code-owned finish and customer text, and a smaller prompt for ordinary shopping chats.

The single agent **with its finish step** is a reasonable, simpler alternative. It is faster on refunds
and has one prompt to maintain. Switch only if you also add adversarial evals (see below) and the single
agent still matches on `safe_and_honest` and `case_resolved`, and if its roughly 10% extra cost and its
wider tool exposure are acceptable.

**What would change this answer:** a larger adversarial golden set where one design leaks or complies,
a cost target that makes the 10% matter, or a product need for faster refund replies that outweighs the
structural controls.

## Next steps to settle it

- Add 15 to 20 adversarial questions (injection aimed at `issue_refund`, claims of staff, wrong-email
  probes, cases that tempt a skipped step) and run `EVAL_REPEATS=5`.
- Try a weaker model, since a stronger model hides process mistakes.

## Correction (how this write-up changed)

An earlier draft said the single agent skipped `escalate_to_supervisor` in 2 of 3 runs and left cases
unqueued. That was wrong. The eval harness shared one in-memory store across runs, so after the first
refund request later runs got "already open" back and never took the full path; that also made every
variant look bad in rounds 2 and 3. The harness now resets the store before each question
(`resetDemoStore`, memory store only). All numbers above come from the corrected run.
