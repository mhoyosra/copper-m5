# Architecture

How the Copper State Labs app fits together. Each module adds a section at the
end (see [Adding a module](#adding-a-module)) when it changes how the app
works: new pages, tables or AI calls.

_Fictional — for educational use._

## The starter app (Module 0)

A Next.js app that builds, runs and deploys with **no environment variables**.
A Google AI Studio key is optional until a module needs one.

| Piece | Where | What it does |
|---|---|---|
| Pages | `app/` | `layout.tsx` sets the fonts and theme; `page.tsx` is the placeholder home page |
| Brand components | `components/copper/` | `Logo`, `SiteHeader`, `SiteFooter`, `ModeToggle` |
| UI kit | `components/ui/` (shadcn), `components/ai-elements/` (AI Elements) | The only UI libraries the app uses |
| Setup card | `components/setup-required.tsx` | `<SetupRequired service="ai" />`, shown instead of a page whose service isn't configured |
| Company catalog | `lib/copper/catalog.ts`, `lib/copper/data/catalog.json` | Product, plan and privacy facts from the Product Bible (Sections 3, 4, 8 and 10). Pages read prices and plan details from here instead of typing them (added in the Module 1 starter) |
| AI wrapper | `lib/ai/call.ts` | `callText` and `callObject`: every model call goes through these and is logged to the terminal |
| Models and prices | `lib/ai/models.ts`, `lib/ai/pricing.ts` | The approved Gemini models and their token prices |

## Data flow

1. A user opens a page in `app/`.
2. Server code checks what's configured (`isAiConfigured()`). If the key is
   missing, the page renders `<SetupRequired />` instead of crashing.
3. Data comes from files under `lib/copper/data/`.
4. AI requests go through `callText` / `callObject` in `lib/ai/call.ts`, which
   calls Google and then prints one `[ai_calls]` line: `module`, `feature`,
   `model`, tokens, `cost_usd`, `latency_ms`, `ok`.

```ts
const { text } = await callText(
  { module: 2, feature: "ask-copper" },
  { prompt },
);
```

## Two kinds of "AI tiers"

Don't mix these up:

- **Copper State Labs' product tiers** (On-device, Raw Ore, Refined, the
  Copper Cloud) are part of the fictional company. They are facts in the
  [Product Bible](copper-state-labs/product-bible.md) and rows in the `ai_tiers`
  table.
- **The models this app calls** are real Claude models listed in
  `lib/ai/models.ts`. Their cost is logged in `ai_calls`.

## Decisions

- **No environment variables required.** Every service is optional, so a fresh
  clone builds and deploys before any accounts are set up.
- **One AI wrapper.** Routing every call through `lib/ai/call.ts` gives one
  place to log cost and latency per module and feature.
- **No authentication or row-level security yet.** They arrive in a later
  module.

## Adding a module

When a module changes how the app fits together, add a section here:

```md
## Module N: <feature name>

**Summary:** one or two sentences: what this adds and why.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/...` | |
| Components | `components/...` | |
| Data | `lib/copper/data/...` | Data files added |
| AI calls | `lib/ai/call.ts` (module, feature) | Model, prompt purpose, expected cost per call |

**Data flow:** user action → page → server code → database / model → response.

**Decisions and trade-offs:** what you chose, the alternatives, and why.

**Risks and open questions:** cost, privacy, accuracy or safety risks, and how
you handle them.
```

## Module 3 starter: Ask Copper

**Summary:** Ask Copper, the Module 2 shopping chatbot, finished: a floating
chat panel that answers prices, totals and stock with four tools and shows
each step. Module 3 teaches it to answer from the customer documents.

| Piece | Where | What it does |
|---|---|---|
| Component | `components/copper/ask-copper.tsx` | The launcher and chat panel, mounted from `app/page.tsx` and opened by the header's `#ask` link. Draws each answer as stations: the tools on offer, thinking, each tool call, then the reply |
| Server Action | `lib/copper/assistant/ask.ts` | `askCopper()`: streams the conversation with `callStream`, up to 5 steps, and sends each step back as a live `Progress` |
| Tools | `lib/copper/assistant/tools.ts` | `copperTools`: `get_products`, `get_prices`, `calculate_cost`, `check_availability` |
| Instructions | `lib/copper/assistant/instructions.ts` | `COPPER_INSTRUCTIONS`. Copper says it can't help yet with warranty, setup, troubleshooting or privacy |
| Data | `lib/copper/inventory.ts`, `lib/copper/documents.ts` | Stock from `lib/copper/data/inventory.json`; `DOCUMENTS`: the four customer documents and their PDF paths under `public/docs/`. The PDFs are added in class |
| AI calls | `{ module: 2, feature: "ask-copper" }` | One streamed call per question |

## Module 3 part 1: document passages (RAG, step 1)

**Summary:** The four customer PDFs in `public/docs/` are cut into short
passages and turned into embeddings (lists of numbers that capture meaning), so
Ask Copper can later find the passages that match a question.

| Piece | Where | What it does |
|---|---|---|
| Script | `scripts/build-passages.ts` (`npm run build-passages`) | Reads each PDF page by page, splits it into passages of about three sentences, embeds them, and saves `lib/copper/data/passages.json`. Re-run it when a PDF changes |
| Splitter | `lib/copper/split.ts` | `splitPage()`: a page's sentences in groups of three, each passage starting with the document title. Passages never cross a page |
| Data | `lib/copper/data/passages.json`, `lib/copper/passages.ts` | `PASSAGES`: each passage's id, document, title, page, text and embedding. Importing it loads the whole file into memory when the app starts |
| AI calls | `callEmbed()` in `lib/ai/call.ts`, `{ module: 3, feature: "embed-passages" }` | `gemini-embedding-001`, 768 numbers per passage. Sent in batches of 90 because Google's free tier allows 100 embeddings a minute |

## Module 3 part 2: search_docs

**Summary:** Ask Copper has a fifth tool, `search_docs`, that answers setup,
troubleshooting, warranty and policy questions from the customer documents
instead of from memory.

| Piece | Where | What it does |
|---|---|---|
| Search | `lib/copper/search.ts` | `searchDocs(question)`: embeds the question (as a query), compares it to every passage by cosine similarity, and returns the 5 closest, each with document title, page, text, score and a link that opens the PDF at that page (`/docs/<id>.pdf#page=N`) |
| Tool | `lib/copper/assistant/tools.ts` | `search_docs`, described to the model for setup, troubleshooting, warranty, refund and privacy questions |
| Instructions | `lib/copper/assistant/instructions.ts` | Copper must call `search_docs` for those questions, answer only from what it returns, and name the document and page |
| Tool card | `components/copper/ask-copper.tsx` | Lists the 5 passages with title, match percentage, an "Open page N" link and a snippet |
| AI calls | `{ module: 3, feature: "search-docs" }` | One embedding call per search, plus the usual `ask-copper` call |

## Module 4: Refund Agent

**Summary:** A second agent, the Refund Agent, reviews the refund requests Ask Copper hands off, for devices and for Copper Plus. Code checks the written policy (Terms and Conditions, Copper Plus FAQ) and the $50 auto-approve limit; a person decides everything larger in the Refund Console. Spec: `specs/module-4/spec.md`.

| Piece | Where | What it does |
|---|---|---|
| Page | `app/support/page.tsx` | The Refund Console: escalated and awaiting-return cases for a person to decide, with Ask Copper docked beside it |
| Support tools | `lib/copper/assistant/tools.ts` | Adds `submit_refund_request` and `get_refund_status`; Ask Copper stays read-only |
| Refund Agent | `lib/copper/refunds/` | `agent.ts`, `instructions.ts`, `tools.ts`, `cases.ts` and `eligibility.ts` (the rules, as plain code) |
| Data | `lib/copper/data/refund-policy.json`; Supabase `orders`, `order_lines`, `subscriptions`, `refund_cases`, `case_events` | Rules, limits and customer text in one file; orders, charges, cases and an append-only event log in tables |
| AI calls | `lib/ai/call.ts` (`{ module: 4, feature: "refund-agent" }`) | One Refund Agent run (up to 6 steps) per request, on top of the Ask Copper call |

**Data flow:** customer message → Ask Copper → `submit_refund_request` → Refund Agent → `lookup_order` → `check_refund_eligibility` (writes the case) → `issue_refund` (within $50) or `escalate_to_supervisor` → Refund Console (a person approves, declines, or marks a returned device received) → Supabase → `get_refund_status` → customer.

**Decisions and trade-offs:** A hand-off between two agents rather than one agent with refund tools, so the customer-facing agent never holds money-moving power. The model drives the review steps (agent-driven), but the case record, not the model, supplies amounts, rules and destination, and the model can only make a decision stricter. Device refunds follow the Terms: approval authorizes the return and the refund is issued after the device is received. Orders and cases are Supabase tables because cases change as people decide them.

**Storage:** `lib/copper/refunds/store.ts` uses the Supabase tables when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, and an in-memory demo store (seeded with eight fictional orders) otherwise, so the app still runs with no setup. The Supabase store is written but not yet run against a live database.

**Risks and open questions:** The Refund Console is open (no sign-in yet), so it is not safe for real money. Order id plus email stands in for identity, and money returns only to the original payment method. A $50 limit sends every device and annual-plan refund to a person. Return shipping, tax and shipping refunds, and email notices are out of scope.

## Tracing (Langfuse)

Every Ask Copper question is one Langfuse trace (`ask-copper-chat`), grouped
into a session by the chat id. It uses Langfuse's official Vercel AI SDK
integration (`@langfuse/vercel-ai-sdk`), registered in `instrumentation.ts` /
`lib/ai/langfuse-setup.ts`, so each model step is its own `generate-response`
generation (model, tokens, cost, time) and each tool call is a tool
observation. The Refund Agent runs inside the `submit_refund_request` tool, so
its steps nest under that tool and one trace shows both agents (`ask-copper`
and `refund-agent`). `lib/ai/call.ts` sets each call's `functionId` to its
feature name. `lib/ai/langfuse.ts` creates the per-turn root observation and
flushes spans before a serverless function stops. Before export,
`lib/ai/langfuse-clean.ts` masks customer emails and gives spans stable names
(not the model name or step number). With no `LANGFUSE_*` keys nothing is
registered and nothing else changes. The Langfuse agent skill is installed in
`.claude/skills/langfuse`.

## Evaluation (golden set and LLM judge)

`evals/golden-set.json` holds 12 golden questions for Ask Copper (shopping,
docs, scope, refunds, safety). Each has a rubric (`expectedOutput`) describing
what a good answer contains. `npm run eval:seed` loads them into the Langfuse
dataset `ask-copper-golden`.

`experiments/ask-copper-gate.ts` runs every question through the real chat
(`lib/evals/run-chat.ts`, so tools and the Refund Agent are exercised), then an
LLM judge (`lib/evals/judge.ts`) scores each answer 0 or 1 on `answer_correct`
and `safe_and_honest`, with its reasoning. Scores are written to Langfuse on the
dataset run. The gate fails when average `answer_correct` is under 0.8, when any
answer is not `safe_and_honest`, or when any chat or judge call failed (a broken
run never counts as a pass). The judge is checked against hand-labeled answers
first (`npm run eval:calibrate`, `evals/judge-calibration.json`, 85% agreement
needed). `.github/workflows/langfuse-eval.yml` runs the gate on every pull
request through `langfuse/experiment-action`; `npm run eval:run` runs it locally.
