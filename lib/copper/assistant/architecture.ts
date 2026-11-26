/**
 * Which design answers: "multi" (Ask Copper hands refunds to the Refund Agent,
 * the default) or "single" (one agent with every tool). Set ASK_COPPER_ARCH.
 * It is read on the server only, so a visitor can't switch it.
 */
export function architecture(): "multi" | "single" {
  return process.env.ASK_COPPER_ARCH === "single" ? "single" : "multi";
}
