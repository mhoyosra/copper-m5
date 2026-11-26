// Shared types for Module 4 refunds: the order data, the request a customer
// makes, the verdict the rules engine returns, the case record, and the
// decision Ask Copper relays. The contract is in specs/module-4/spec.md.
import { z } from "zod";
import type { Actor } from "@/lib/copper/refunds/actor";

export const ITEMS = ["copper-home", "copper-notes", "copper-plus"] as const;
export type ItemId = (typeof ITEMS)[number];

export const REASON_CODES = [
  "changed_mind",
  "defective",
  "billing_error",
  "outage_bug",
  "other",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export type LineKind = "device" | "service";

/** One thing on an order: a device, or one charge of a subscription. */
export type OrderLine = {
  id: string;
  orderId: string;
  item: ItemId;
  kind: LineKind;
  plan: "annual" | "monthly" | "free" | null;
  /** What the customer paid for this line, in dollars. */
  amountUsd: number;
  /** Purchase date (devices) or charge date (services), YYYY-MM-DD. */
  chargedAt: string;
  /** The day a device was received, YYYY-MM-DD, or null if not yet. */
  deliveredAt: string | null;
  /** The month a monthly charge covers, like "2026-11". */
  billingPeriod: string | null;
  refundedUsd: number;
  subscriptionId: string | null;
};

export type Order = { id: string; email: string; lines: OrderLine[] };

export type Subscription = {
  id: string;
  orderId: string;
  plan: "annual" | "monthly" | "free";
  status: "active" | "ended";
  endedAt: string | null;
};

export const refundRequestSchema = z.strictObject({
  orderId: z.string().min(1).max(40),
  email: z.email().max(120),
  item: z.enum(ITEMS),
  chargeId: z.string().min(1).max(60).optional(),
  confirmsPlanEnds: z.boolean().optional(),
  reasonCode: z.enum(REASON_CODES),
  customerMessage: z.string().max(500),
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;

export type CaseStatus =
  | "reviewing"
  | "rejected"
  | "escalated"
  | "awaiting_return"
  | "refunded"
  | "declined"
  | "handled_elsewhere";

/** A line can have at most one case in one of these states. */
export const LIVE_STATUSES: CaseStatus[] = [
  "reviewing",
  "escalated",
  "awaiting_return",
  "refunded",
];

export type NeedsInfo =
  "item_not_on_order" | "which_charge" | "confirm_plan_end";

export type Verdict = {
  /** eligible = refundable and within the auto limit; escalate = a person decides. */
  result: "eligible" | "escalate" | "not_eligible" | "needs_info";
  ruleApplied: string;
  lineId: string | null;
  amountUsd: number | null;
  endsPlan: boolean;
  requiresReturn: boolean;
  /** True when the written policy allows the refund (a person may approve it). */
  policyEligible: boolean;
  reviewReason: "over_limit" | "exception" | "unclear" | null;
  needsInfo: NeedsInfo | null;
};

export type RefundCase = {
  id: string;
  orderId: string;
  lineId: string | null;
  email: string;
  item: ItemId;
  kind: LineKind | null;
  status: CaseStatus;
  ruleApplied: string;
  amountUsd: number | null;
  endsPlan: boolean;
  requiresReturn: boolean;
  policyEligible: boolean;
  autoApproved: boolean;
  reasonCode: ReasonCode;
  customerMessage: string;
  summary: string | null;
  requestedAt: string;
  decidedBy: Actor | null;
  decidedAt: string | null;
  note: string | null;
};

export type RefundDecision = {
  outcome: "approved" | "rejected" | "escalated" | "needs_info";
  caseId: string | null;
  ruleApplied: string;
  amountUsd: number | null;
  nextStep: "refund_issued" | "awaiting_return" | "supervisor_review" | "none";
  planEnded: boolean;
  statusText: string;
  explanation: string;
};

export type CaseEvent = {
  caseId: string;
  at: string;
  actor: Actor | "system";
  event: string;
  detail: string | null;
};
