// The one code path that moves a refund case between states. The Refund
// Agent's tools and the Refund Console's buttons both call these functions, so
// the rules can't differ between them. Each change is checked against the
// current state and logged to the case's event trail.
import { checkRefundEligibility } from "@/lib/copper/refunds/eligibility";
import { getPolicy } from "@/lib/copper/refunds/policy";
import type { Actor } from "@/lib/copper/refunds/actor";
import type { RefundStore } from "@/lib/copper/refunds/store";
import type {
  Order,
  RefundCase,
  RefundRequest,
  Verdict,
} from "@/lib/copper/refunds/types";

export type CaseResult =
  { ok: true; case: RefundCase } | { ok: false; reason: string };

const DAY = 86_400_000;

export async function logEvent(
  store: RefundStore,
  caseId: string,
  actor: Actor | "system",
  event: string,
  detail: string | null = null,
) {
  await store.addEvent({
    caseId,
    at: new Date().toISOString(),
    actor,
    event,
    detail,
  });
}

/** Runs the rules for a verified order, including this customer's 90-day total. */
export async function evaluate(
  store: RefundStore,
  order: Order,
  request: RefundRequest,
  requestedAt: Date,
): Promise<Verdict> {
  const days = getPolicy().autoApprove.windowDays;
  const prior = await store.autoRefundedSince(
    request.email,
    new Date(requestedAt.getTime() - days * DAY),
  );
  return checkRefundEligibility({
    order,
    request,
    requestedAt,
    priorAutoRefundedUsd: prior,
  });
}

/**
 * Creates the case for a verdict (never for needs_info). A rejection is a
 * finished case; an eligible or escalate verdict starts as "reviewing". If the
 * order line already has a live case, that case is returned instead.
 */
export async function openCase(
  store: RefundStore,
  args: { request: RefundRequest; order: Order; verdict: Verdict; now?: Date },
): Promise<{ case: RefundCase; created: boolean }> {
  const { request, order, verdict } = args;
  const now = args.now ?? new Date();
  const line = order.lines.find((l) => l.id === verdict.lineId);
  const rejected = verdict.result === "not_eligible";
  const result = await store.createCase({
    id: crypto.randomUUID(),
    orderId: order.id,
    lineId: verdict.lineId,
    email: order.email,
    item: request.item,
    kind: line?.kind ?? null,
    status: rejected ? "rejected" : "reviewing",
    ruleApplied: verdict.ruleApplied,
    amountUsd: verdict.amountUsd,
    endsPlan: verdict.endsPlan,
    requiresReturn: verdict.requiresReturn,
    policyEligible: verdict.policyEligible,
    autoApproved: verdict.result === "eligible",
    reasonCode: request.reasonCode,
    customerMessage: request.customerMessage,
    summary: null,
    requestedAt: now.toISOString(),
    decidedBy: rejected ? "refund-agent" : null,
    decidedAt: rejected ? now.toISOString() : null,
    note: null,
  });
  if (result.created) {
    await logEvent(
      store,
      result.case.id,
      "refund-agent",
      "case_opened",
      verdict.ruleApplied,
    );
  }
  return result;
}

/** Hands a reviewing case to a person. The only action that makes things stricter. */
export async function escalateCase(
  store: RefundStore,
  caseId: string,
  summary: string,
  actor: Actor,
): Promise<CaseResult> {
  const current = await store.getCase(caseId);
  if (!current) return { ok: false, reason: "case_not_found" };
  if (current.status === "escalated") return { ok: true, case: current };
  const moved = await store.transition(caseId, ["reviewing"], {
    status: "escalated",
    summary: summary.slice(0, 300),
  });
  if (!moved) return { ok: false, reason: "not_reviewing" };
  await logEvent(store, caseId, actor, "escalated", summary.slice(0, 300));
  return { ok: true, case: moved };
}

/**
 * Issues the refund for a case. The amount, rule and plan ending all come from
 * the case record, never from the caller. A device moves to awaiting_return
 * (the money moves when the device is received); a service is refunded now,
 * and its plan ends in the same step when the rule says so.
 */
export async function issueRefund(
  store: RefundStore,
  caseId: string,
  actor: Actor,
): Promise<CaseResult> {
  const c = await store.getCase(caseId);
  if (!c) return { ok: false, reason: "case_not_found" };

  const allowedFrom: RefundCase["status"][] =
    actor === "console" ? ["escalated"] : ["reviewing"];
  if (!allowedFrom.includes(c.status))
    return { ok: false, reason: "wrong_state" };
  if (!c.policyEligible || !c.lineId || c.amountUsd === null) {
    return { ok: false, reason: "not_refundable" };
  }
  // Only a person (the console) may approve a case the limit sent to review.
  // Written as "anyone but the console" so a new kind of agent is limited by
  // default, not trusted by default.
  if (actor !== "console" && !c.autoApproved) {
    return { ok: false, reason: "needs_a_person" };
  }

  // Re-check against the current order, as of the day the customer asked.
  const order = await store.getOrderById(c.orderId);
  if (!order) return { ok: false, reason: "order_not_found" };
  const requestedAt = new Date(c.requestedAt);
  const recheck = checkRefundEligibility({
    order,
    request: {
      item: c.item,
      reasonCode: c.reasonCode,
      chargeId: c.lineId,
      confirmsPlanEnds: c.endsPlan ? true : undefined,
    },
    requestedAt,
    priorAutoRefundedUsd: 0,
    ignoreLimit: true,
  });
  if (
    !recheck.policyEligible ||
    recheck.lineId !== c.lineId ||
    recheck.amountUsd !== c.amountUsd
  ) {
    return { ok: false, reason: "changed_since_review" };
  }

  if (c.requiresReturn) {
    const moved = await store.transition(caseId, allowedFrom, {
      status: "awaiting_return",
      decidedBy: actor,
      decidedAt: new Date().toISOString(),
    });
    if (!moved) return { ok: false, reason: "wrong_state" };
    await logEvent(store, caseId, actor, "return_approved");
    return { ok: true, case: moved };
  }

  const refunded = await store.applyRefund({
    caseId,
    from: allowedFrom,
    decidedBy: actor,
  });
  if (!refunded) return { ok: false, reason: "wrong_state" };
  await logEvent(
    store,
    caseId,
    actor,
    "refunded",
    refunded.endsPlan ? "plan ended" : null,
  );
  return { ok: true, case: refunded };
}

/** The person marks a returned device received: the refund is issued. */
export async function markReceived(
  store: RefundStore,
  caseId: string,
): Promise<CaseResult> {
  const refunded = await store.applyRefund({
    caseId,
    from: ["awaiting_return"],
    decidedBy: "console",
  });
  if (!refunded) return { ok: false, reason: "not_awaiting_return" };
  await logEvent(store, caseId, "console", "device_received_refunded");
  return { ok: true, case: refunded };
}

export async function declineCase(
  store: RefundStore,
  caseId: string,
  note: string,
): Promise<CaseResult> {
  const moved = await store.transition(caseId, ["escalated"], {
    status: "declined",
    decidedBy: "console",
    decidedAt: new Date().toISOString(),
    note: note.slice(0, 300),
  });
  if (!moved) return { ok: false, reason: "not_escalated" };
  await logEvent(store, caseId, "console", "declined", note.slice(0, 300));
  return { ok: true, case: moved };
}

export async function markHandledElsewhere(
  store: RefundStore,
  caseId: string,
  note: string,
): Promise<CaseResult> {
  const moved = await store.transition(caseId, ["escalated"], {
    status: "handled_elsewhere",
    decidedBy: "console",
    decidedAt: new Date().toISOString(),
    note: note.slice(0, 300),
  });
  if (!moved) return { ok: false, reason: "not_escalated" };
  await logEvent(
    store,
    caseId,
    "console",
    "handled_elsewhere",
    note.slice(0, 300),
  );
  return { ok: true, case: moved };
}
