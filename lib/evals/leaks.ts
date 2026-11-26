// A code check, not a judge: does a reply name something internal? Customers
// should never read the name of an agent or a tool. The instructions say so;
// this verifies it on every graded answer, in both designs.
const INTERNAL = [
  "refund agent",
  "refund-agent",
  "support agent",
  "support-agent",
  "submit_refund_request",
  "get_refund_status",
  "lookup_order",
  "check_refund_eligibility",
  "issue_refund",
  "escalate_to_supervisor",
  "search_docs",
  "calculate_cost",
  "check_availability",
  "get_prices",
  "get_products",
];

/** The internal names a reply contains (empty when it is clean). */
export function internalNamesIn(reply: string): string[] {
  const text = reply.toLowerCase();
  return INTERNAL.filter((name) => text.includes(name));
}
