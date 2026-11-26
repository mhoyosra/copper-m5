// The two tools Module 4 adds to Ask Copper. Ask Copper stays read-only: it
// hands a refund request to the Refund Agent and relays the decision, and it
// can look up a case's status. Neither tool can issue a refund itself.
import { tool } from "ai";
import { z } from "zod";
import { runRefundReview } from "@/lib/copper/refunds/agent";
import {
  decisionFromCase,
  needsInfoDecision,
} from "@/lib/copper/refunds/decision";
import { findOrder } from "@/lib/copper/refunds/review";
import { getStore } from "@/lib/copper/refunds/store";
import { refundRequestSchema } from "@/lib/copper/refunds/types";

export function createRefundSupportTools({ chatId }: { chatId: string }) {
  return {
    submit_refund_request: tool({
      description:
        "Submit a customer's refund request for review and get the decision. Use it only when the customer actually asks for money back, after you have the order number, the email on the order, which item, and a reason. For an annual Copper Plus plan, set confirmsPlanEnds to true only if the customer clearly agreed that the refund ends their plan. You do not decide refunds.",
      inputSchema: refundRequestSchema,
      execute: async (request) => runRefundReview(request, { chatId }),
    }),
    get_refund_status: tool({
      description:
        "Look up the status of a customer's refund case, from their order number and the email on the order. Read-only.",
      inputSchema: z.strictObject({
        orderId: z.string().min(1).max(40),
        email: z.email().max(120),
      }),
      execute: async ({ orderId, email }) => {
        const found = await findOrder(getStore(), { orderId, email, chatId });
        if (!found.found) {
          return {
            found: false,
            message: needsInfoDecision(
              found.blocked ? "lookups_blocked" : "order_not_found",
            ).statusText,
          };
        }
        const cases = await getStore().casesForOrder(found.order.id);
        return {
          found: true,
          cases: cases.map((c) => ({ item: c.item, ...decisionFromCase(c) })),
        };
      },
    }),
  };
}
