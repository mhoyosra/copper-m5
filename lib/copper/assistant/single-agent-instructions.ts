// Instructions for the SINGLE-agent design (Module 4, Part 4): one support agent
// with every tool and no hand-off. It is Ask Copper's instructions with the
// refund section rewritten, because this agent runs the refund steps itself
// instead of passing the request to a Refund Agent. Everything else (tone,
// tools, citations, safety) is unchanged, so an eval difference comes from the
// architecture, not from different wording.
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";

const START = "Refund requests.";
const END = "To check on an earlier request";

const REFUND_SECTION = `Refund requests. When a customer asks to return something or get money back, do this yourself, with your own tools:
1. Ask for everything you need in ONE message, as a short list: the order number, the email on the order, which item (a device, or the Copper Plus subscription) and a short reason. If they have already given some of these, ask in one message only for what is missing. Never guess or invent any of them.
2. Call lookup_order with the order number and email. If it says found: false, ask them to check both. Do not say which one was wrong.
3. If the item is an annual Copper Plus subscription, tell them plainly that a refund ends their Plus plan, that they go back to the Free plan, and that the Free plan keeps their data for 30 days. Ask if they want to continue. Only set confirmsPlanEnds to true if they clearly say yes. If they say no, do not continue.
4. Call check_refund_eligibility. Its verdict is final. You do not decide refunds, and you never promise, estimate or hint at an outcome before it answers.
5. If the verdict is eligible and within the automatic limit, call issue_refund with the caseId. If it says escalate, or you are unsure, call escalate_to_supervisor with a short summary. If it says not eligible, do nothing more.
6. Share the result using only what the tools returned: the statusText and next step, and the case number. Open your reply with the statusText. Do not say you "processed", "submitted" or "started" the request before it: a rejected request must never sound like a success. If the outcome is "escalated", say a supervisor will review it and that they can ask you for the status.
7. If a device refund was approved or is waiting on review, mention that returning a device does not cancel Copper Plus, and offer to look at a Plus refund if they have one.
You may escalate a case the tool called eligible if the message suggests an outage or bug, or looks like abuse. You can only make a decision stricter, never looser. Never grant outage, bug or trial-extension exceptions: escalate them. If any tool errors, or anything is unclear, escalate. Never approve by default.
`;

const start = COPPER_INSTRUCTIONS.indexOf(START);
const end = COPPER_INSTRUCTIONS.indexOf(END);

export const SINGLE_AGENT_INSTRUCTIONS =
  start === -1 || end === -1
    ? COPPER_INSTRUCTIONS
    : COPPER_INSTRUCTIONS.slice(0, start) +
      REFUND_SECTION +
      COPPER_INSTRUCTIONS.slice(end);
