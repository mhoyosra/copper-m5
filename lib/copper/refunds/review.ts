// One refund review: the steps (look up the order, check the rules, open the
// case) as plain functions. The Refund Agent's tools call them, and so does
// the code that finishes the review, so the order of steps is enforced by the
// data (a check needs a verified order), not by the prompt.
import { escalateCase, evaluate, openCase } from "@/lib/copper/refunds/cases";
import {
  decisionFromCase,
  needsInfoDecision,
  type NeedsInfoKey,
} from "@/lib/copper/refunds/decision";
import { getPolicy } from "@/lib/copper/refunds/policy";
import type { RefundStore } from "@/lib/copper/refunds/store";
import type {
  Order,
  RefundCase,
  RefundDecision,
  RefundRequest,
  Verdict,
} from "@/lib/copper/refunds/types";

export type ReviewContext = {
  store: RefundStore;
  request: RefundRequest;
  /** One per chat: failed lookups are counted against it. */
  chatId: string;
  now: Date;
  order: Order | null;
  lookupTried: boolean;
  lookupBlocked: boolean;
  verdict: Verdict | null;
  case: RefundCase | null;
  /** The line already had a live case, so no new one was made. */
  existingCase: boolean;
  needsInfo: NeedsInfoKey | null;
};

export function newContext(args: {
  store: RefundStore;
  request: RefundRequest;
  chatId: string;
  now?: Date;
}): ReviewContext {
  return {
    ...args,
    now: args.now ?? new Date(),
    order: null,
    lookupTried: false,
    lookupBlocked: false,
    verdict: null,
    case: null,
    existingCase: false,
    needsInfo: null,
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * The per-email daily limit on refund requests. Returns false when the email
 * is over it; otherwise counts this request and returns true. Both the Refund
 * Agent and the single support agent go through here.
 */
export async function allowSubmission(
  store: RefundStore,
  email: string,
): Promise<boolean> {
  const limit = getPolicy().rateLimits.submissionsPerEmailPerDay;
  const since = new Date(Date.now() - DAY);
  if ((await store.countAttempts("submission", email, since)) >= limit) {
    return false;
  }
  await store.recordAttempt("submission", email);
  return true;
}

/**
 * Finds the order by id AND email. A wrong id and a wrong email look the same,
 * and after a few failures in one chat the lookups stop.
 */
export async function findOrder(
  store: RefundStore,
  args: { orderId: string; email: string; chatId: string },
): Promise<{ found: true; order: Order } | { found: false; blocked: boolean }> {
  const limit = getPolicy().rateLimits.failedLookupsPerChat;
  const failures = await store.countAttempts(
    "failed_lookup",
    args.chatId,
    new Date(Date.now() - DAY),
  );
  if (failures >= limit) return { found: false, blocked: true };
  const order = await store.getOrder(args.orderId, args.email);
  if (!order) {
    await store.recordAttempt("failed_lookup", args.chatId);
    return { found: false, blocked: false };
  }
  return { found: true, order };
}

export async function doLookup(ctx: ReviewContext) {
  ctx.lookupTried = true;
  const result = await findOrder(ctx.store, {
    orderId: ctx.request.orderId,
    email: ctx.request.email,
    chatId: ctx.chatId,
  });
  if (result.found) {
    ctx.order = result.order;
  } else {
    ctx.lookupBlocked = result.blocked;
  }
  return result;
}

/** Checks the rules for the verified order and opens the case. */
export async function doCheck(ctx: ReviewContext) {
  if (!ctx.order) return { error: "lookup_order must succeed first" } as const;
  const verdict = await evaluate(ctx.store, ctx.order, ctx.request, ctx.now);
  ctx.verdict = verdict;
  if (verdict.result === "needs_info") {
    ctx.needsInfo = verdict.needsInfo as NeedsInfoKey;
    return { result: "needs_info" as const, needs: verdict.needsInfo };
  }
  const { case: c, created } = await openCase(ctx.store, {
    request: ctx.request,
    order: ctx.order,
    verdict,
    now: ctx.now,
  });
  ctx.case = c;
  ctx.existingCase = !created;
  if (!created) {
    return { result: "already_open" as const, caseId: c.id, status: c.status };
  }
  return {
    result: verdict.result,
    caseId: c.id,
    rule: verdict.ruleApplied,
    amountUsd: verdict.amountUsd,
    endsPlan: verdict.endsPlan,
    requiresReturn: verdict.requiresReturn,
    reviewReason: verdict.reviewReason,
  };
}

/**
 * Finishes a review, filling in any step the model skipped and failing closed:
 * a case still "reviewing" is handed to a person. The decision is built from
 * the case record, never from the model's words.
 */
export async function finishReview(
  ctx: ReviewContext,
  explanation = "",
): Promise<RefundDecision> {
  if (!ctx.order && !ctx.lookupTried) await doLookup(ctx);
  if (!ctx.order) {
    return needsInfoDecision(
      ctx.lookupBlocked ? "lookups_blocked" : "order_not_found",
    );
  }
  if (!ctx.verdict) await doCheck(ctx);
  if (ctx.needsInfo) return needsInfoDecision(ctx.needsInfo);
  if (!ctx.case) {
    // Should not happen: the check always opens a case unless it needs info.
    return needsInfoDecision("order_not_found");
  }

  let current = (await ctx.store.getCase(ctx.case.id)) ?? ctx.case;
  if (current.status === "reviewing") {
    const escalated = await escalateCase(
      ctx.store,
      current.id,
      "The review did not finish, so a person needs to look at it.",
      "refund-agent",
    );
    if (escalated.ok) current = escalated.case;
  }
  // A case that was already open keeps its own status text, with no new explanation.
  return decisionFromCase(current, ctx.existingCase ? "" : explanation);
}
