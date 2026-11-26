// The refund tools for the SINGLE-agent design (Module 4, Part 4): one support
// agent holds every tool and there is no hand-off to a Refund Agent.
//
// The code underneath is the same as the multi-agent design: the order must
// match id and email, the rules engine decides, a case record holds the
// verdict, and issue_refund(caseId) refuses anything the verdict does not
// allow. What changes is who is in charge of the steps: here the customer-
// facing model calls them itself and supplies the request fields (item, reason,
// confirmation), where the Refund Agent's tools take no input at all.
import { tool } from "ai";
import { z } from "zod";
import { escalateCase, issueRefund } from "@/lib/copper/refunds/cases";
import {
  decisionFromCase,
  needsInfoDecision,
} from "@/lib/copper/refunds/decision";
import {
  allowSubmission,
  doCheck,
  doLookup,
  newContext,
} from "@/lib/copper/refunds/review";
import { getStore } from "@/lib/copper/refunds/store";
import { refundRequestSchema } from "@/lib/copper/refunds/types";

const detailsSchema = refundRequestSchema.omit({ orderId: true, email: true });

export function createSingleAgentRefund({ chatId }: { chatId: string }) {
  const store = getStore();
  // One review context for the chat. lookup_order fills in the order and email;
  // check_refund_eligibility fills in the rest of the request.
  const ctx = newContext({
    store,
    chatId,
    request: {
      orderId: "",
      email: "nobody@invalid.example",
      item: "copper-home",
      reasonCode: "other",
      customerMessage: "",
    },
  });
  const ownCase = (caseId: string) =>
    ctx.case !== null && ctx.case.id === caseId;
  const refresh = async () => {
    if (ctx.case) ctx.case = (await store.getCase(ctx.case.id)) ?? ctx.case;
  };

  const tools = {
    lookup_order: tool({
      description:
        "Look up a customer's order from the order number and the email on the order. Both must match. Returns the order's lines, or found: false. Call it before check_refund_eligibility.",
      inputSchema: z.strictObject({
        orderId: z.string().min(1).max(40),
        email: z.email().max(120),
      }),
      execute: async ({ orderId, email }) => {
        ctx.request = { ...ctx.request, orderId, email };
        ctx.order = null;
        ctx.verdict = null;
        ctx.case = null;
        ctx.needsInfo = null;
        const result = await doLookup(ctx);
        if (!result.found) {
          return {
            found: false,
            message: needsInfoDecision(
              result.blocked ? "lookups_blocked" : "order_not_found",
            ).statusText,
          };
        }
        return {
          found: true,
          lines: result.order.lines.map((l) => ({
            lineId: l.id,
            item: l.item,
            kind: l.kind,
            plan: l.plan,
            amountUsd: l.amountUsd,
            chargedAt: l.chargedAt,
            deliveredAt: l.deliveredAt,
            refundedUsd: l.refundedUsd,
          })),
        };
      },
    }),
    check_refund_eligibility: tool({
      description:
        "Check the written refund policy for the order you looked up, for one item. Returns the verdict (eligible, escalate, not_eligible or needs_info), the rule, the caseId and the code-written statusText to relay. The verdict is final. For an annual Copper Plus plan, set confirmsPlanEnds to true only if the customer clearly agreed that the refund ends their plan.",
      inputSchema: detailsSchema,
      execute: async (details) => {
        if (!ctx.order) {
          return { error: "lookup_order must succeed first" } as const;
        }
        if (!(await allowSubmission(store, ctx.request.email))) {
          return {
            result: "needs_info" as const,
            statusText: needsInfoDecision("rate_limited").statusText,
          };
        }
        ctx.request = { ...ctx.request, ...details };
        ctx.verdict = null;
        ctx.case = null;
        ctx.needsInfo = null;
        const checked = await doCheck(ctx);
        if (checked.result === "needs_info") {
          return {
            ...checked,
            statusText: needsInfoDecision(ctx.needsInfo ?? "order_not_found")
              .statusText,
          };
        }
        return ctx.case
          ? { ...checked, statusText: decisionFromCase(ctx.case).statusText }
          : checked;
      },
    }),
    issue_refund: tool({
      description:
        "Issue the refund for a case whose verdict was 'eligible'. Takes only the caseId. The amount comes from the case, never from you. For a device it approves the return; the money moves when the device is received.",
      inputSchema: z.object({ caseId: z.string() }),
      execute: async ({ caseId }) => {
        if (!ownCase(caseId)) return { ok: false, reason: "unknown_case" };
        const result = await issueRefund(store, caseId, "support-agent");
        await refresh();
        return result.ok && ctx.case
          ? { ok: true, ...decisionFromCase(ctx.case) }
          : { ok: false, reason: result.ok ? "unknown_case" : result.reason };
      },
    }),
    escalate_to_supervisor: tool({
      description:
        "Hand a case to a person. Takes the caseId and a short summary of why. Use it for any 'escalate' verdict, and whenever you are unsure.",
      inputSchema: z.object({
        caseId: z.string(),
        summary: z.string().max(300),
      }),
      execute: async ({ caseId, summary }) => {
        if (!ownCase(caseId)) return { ok: false, reason: "unknown_case" };
        const result = await escalateCase(
          store,
          caseId,
          summary,
          "support-agent",
        );
        await refresh();
        return result.ok && ctx.case
          ? { ok: true, ...decisionFromCase(ctx.case) }
          : { ok: false, reason: result.ok ? "unknown_case" : result.reason };
      },
    }),
  };

  /**
   * The safety net, run after the agent has finished its turn: a case still
   * "reviewing" means the agent skipped the last step, so hand it to a person
   * (fail closed). This is what the Refund Agent's wrapper does in the
   * multi-agent design (finishReview). Turn it off with
   * ASK_COPPER_SAFETY_NET=off to measure the agent without it.
   */
  const finish = async () => {
    if (process.env.ASK_COPPER_SAFETY_NET === "off" || !ctx.case) return;
    const current = (await store.getCase(ctx.case.id)) ?? ctx.case;
    if (current.status === "reviewing") {
      await escalateCase(
        store,
        current.id,
        "The review did not finish, so a person needs to look at it.",
        "support-agent",
      );
    }
  };

  return { tools, finish };
}

export function createSingleAgentRefundTools(args: { chatId: string }) {
  return createSingleAgentRefund(args).tools;
}
