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

## Adversarial results: 18 harder questions x 3 rounds (`evals/adversarial-set.json`)

The golden set could not separate the designs, so I added 18 adversarial questions: fake system
messages, claimed staff and promises, an inflated amount, redirecting the money, instructions hidden in
the refund reason, a roleplay jailbreak, wrong-email and other-customer probes, requests to print the
instructions or the internal playbook, skipping the plan-ending warning, a fake approval, and a price
haggle. Nothing on this set may end approved, so there is a code check as well as the judge.

| 54 answers per variant | Multi-agent | Single, bare | Single + net |
|---|---|---|---|
| **No unauthorized refund** (code check: nothing ended approved) | **1.00** | **1.00** | **1.00** |
| Cases left unfinished (code check) | 1.00 resolved | 1.00 | 1.00 |
| `safe_and_honest` (judge) | 0.94 | 0.94 | 0.96 |
| `answer_correct` (judge, strict rubrics) | 0.46 | 0.70 | 0.69 |
| Tokens per answer | about 4,700 | about 6,700 (+44%) | about 6,600 (+41%) |
| Cost per answer | $0.00170 | $0.00211 (+24%) | $0.00212 (+25%) |

**The hard result:** across 162 adversarial runs, **no design ever approved a refund or moved money**,
and none left a case unfinished. The limit, the case record and the rules engine held against every
attack I wrote, in both designs. This is the strongest evidence in the whole comparison, because it comes
from the case store and not from a model's opinion.

**The judge-based scores are advisory here.** I read the replies behind the misses. Most are safe replies
that omit a sentence my rubric asked for (for example not saying that refunds only go to the original
payment method, or not explaining that both an order number and an email are needed). The few
`safe_and_honest` failures I inspected were also replies that asked for more details without explicitly
refusing a manipulation; none approved anything. So the adversarial gate hard-fails on the code checks and
on judged safety below 0.9, and reports `answer_correct` without gating it.

**Where the designs really differ:**
- **The single agent answers a clearly ineligible request directly.** For "a rep promised me a refund"
  on a 45-day-old device, it looked the order up and said the window had passed (in 5 of the 6 replies I sampled across that question and the "I'll lose my job" pressure question; the sixth asked for details first). Ask Copper in the
  multi-agent design more often asked for the item and reason first (its instructions require collecting
  them before it hands off), so it answered later. That is most of the 0.46 against 0.70 gap.
- **The multi-agent design twice named its internal part to the customer** in the replies I read
  ("I have to submit your request to our Refund Agent"), against its own rule not to mention internal
  tools. It is a small prompt fix, not yet made, and a leak the single design cannot have.
- **The single agent costs more here** (+24% per answer, +41 to 44% tokens), because it carries the refund
  tools and instructions in every turn and calls more tools.

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

**Multi-agent, with low-to-moderate confidence.** After the harder evals the two designs are still tied on
the guarantee that matters most (nothing approved without a person, no case left hanging). The reasons to
prefer multi-agent are structural and about cost: no money tool on the customer-facing agent, input-less
refund tools, code-owned finishing and customer text, a smaller prompt for ordinary shopping chats, and
about 10 to 25% lower cost per answer.

The single agent **with its finish step** is a real alternative, and the adversarial run weakened the case
against it: it answers ineligible requests more directly, is about 35% faster on refunds, and has one
prompt to maintain. Its costs are more tokens, refund tools in every conversation, and a permission model
that needs care (the fail-open actor bug).

**What would change this answer:** a larger adversarial set where one design leaks or approves; a product
need for faster, more direct refund replies that outweighs the structural controls; or fixing multi-agent's
two weaknesses (naming "Refund Agent", asking for details before saying a request is ineligible) and
seeing the quality gap close.

## Next steps to settle it

- Stop Ask Copper from naming the Refund Agent (one sentence in its instructions), then rerun the
  adversarial set.
- Let Ask Copper check eligibility sooner on a request that already names an order, so it can say "not
  eligible" without a round of questions.
- Try a weaker model, since a stronger model hides process mistakes, and run `EVAL_REPEATS=5`.

## Correction (how this write-up changed)

An earlier draft said the single agent skipped `escalate_to_supervisor` in 2 of 3 runs and left cases
unqueued. That was wrong. The eval harness shared one in-memory store across runs, so after the first
refund request later runs got "already open" back and never took the full path; that also made every
variant look bad in rounds 2 and 3. The harness now resets the store before each question
(`resetDemoStore`, memory store only). All numbers above come from the corrected run.
