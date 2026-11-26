// @vitest-environment node
// Module 4, Part 4: the single-agent refund tools. One agent holds every tool,
// so these tests check that the same guarantees hold without a Refund Agent:
// the order must match, the rules engine decides, the case record gates the
// money, and a model that skips or abuses steps changes nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryStore,
  type RefundStore,
} from "@/lib/copper/refunds/store";

let store: RefundStore;
vi.mock("@/lib/copper/refunds/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/copper/refunds/store")>()),
  getStore: () => store,
}));

import { SINGLE_AGENT_INSTRUCTIONS } from "@/lib/copper/assistant/single-agent-instructions";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import {
  createSingleAgentRefund,
  createSingleAgentRefundTools,
} from "@/lib/copper/refunds/single-agent-tools";

type Tools = ReturnType<typeof createSingleAgentRefundTools>;
// Runs a tool the way the AI SDK does.
const run = async <K extends keyof Tools>(
  tools: Tools,
  name: K,
  input: unknown,
) =>
  (await (
    tools[name] as unknown as {
      execute: (i: unknown, o: unknown) => Promise<unknown>;
    }
  ).execute(input, { toolCallId: "t", messages: [] })) as Record<
    string,
    unknown
  >;

const details = {
  item: "copper-home",
  reasonCode: "changed_mind",
  customerMessage: "I changed my mind",
};

describe("single-agent refund tools", () => {
  let tools: Tools;
  beforeEach(() => {
    store = createMemoryStore();
    tools = createSingleAgentRefundTools({ chatId: "chat-1" });
  });

  it("will not check eligibility before an order is verified", async () => {
    const out = await run(tools, "check_refund_eligibility", details);
    expect(out.error).toMatch(/lookup_order must succeed first/);
  });

  it("gives a wrong email the same reply as a wrong order number", async () => {
    const wrongEmail = await run(tools, "lookup_order", {
      orderId: "CSL-1001",
      email: "mallory@example.com",
    });
    const wrongOrder = await run(tools, "lookup_order", {
      orderId: "CSL-9999",
      email: "ada@example.com",
    });
    expect(wrongEmail).toEqual(wrongOrder);
    expect(wrongEmail.found).toBe(false);
  });

  it("stops lookups after repeated failures in one chat", async () => {
    for (let i = 0; i < 3; i++) {
      await run(tools, "lookup_order", {
        orderId: "CSL-0",
        email: "x@example.com",
      });
    }
    const out = await run(tools, "lookup_order", {
      orderId: "CSL-1001",
      email: "ada@example.com",
    });
    expect(out.found).toBe(false); // blocked even with the right details
  });

  it("sends a $149 device refund to a supervisor, and issue_refund refuses it", async () => {
    await run(tools, "lookup_order", {
      orderId: "CSL-1001",
      email: "ada@example.com",
    });
    const check = await run(tools, "check_refund_eligibility", details);
    expect(check.result).toBe("escalate");
    const caseId = check.caseId as string;
    const issue = await run(tools, "issue_refund", { caseId });
    expect(issue.ok).toBe(false); // the stored verdict is not "eligible"
    const escalated = await run(tools, "escalate_to_supervisor", {
      caseId,
      summary: "Over the automatic limit",
    });
    expect(escalated).toMatchObject({ ok: true, outcome: "escalated" });
    expect((await store.getCase(caseId))?.status).toBe("escalated");
  });

  it("rejects a refund outside the window and cannot be talked into issuing it", async () => {
    await run(tools, "lookup_order", {
      orderId: "CSL-1002",
      email: "ben@example.com",
    });
    const check = await run(tools, "check_refund_eligibility", {
      ...details,
      item: "copper-notes",
      reasonCode: "defective",
    });
    expect(check.result).toBe("not_eligible");
    const issue = await run(tools, "issue_refund", { caseId: check.caseId });
    expect(issue.ok).toBe(false);
  });

  it("cannot act on a case that was not opened in this chat", async () => {
    const issue = await run(tools, "issue_refund", { caseId: "made-up" });
    expect(issue).toEqual({ ok: false, reason: "unknown_case" });
    const esc = await run(tools, "escalate_to_supervisor", {
      caseId: "made-up",
      summary: "x",
    });
    expect(esc).toEqual({ ok: false, reason: "unknown_case" });
  });

  it("applies the daily limit on requests per email", async () => {
    const t = tools;
    let last: Record<string, unknown> = {};
    for (let i = 0; i < 4; i++) {
      await run(t, "lookup_order", {
        orderId: "CSL-1001",
        email: "ada@example.com",
      });
      last = await run(t, "check_refund_eligibility", details);
    }
    expect(last.result).toBe("needs_info"); // over 3 submissions in a day
  });

  it("has no tool that takes an amount or a destination", () => {
    for (const t of Object.values(tools)) {
      const shape = JSON.stringify(
        (t as unknown as { inputSchema: unknown }).inputSchema,
      );
      expect(shape).not.toMatch(/amount|destination|card|account/i);
    }
  });
});

describe("single-agent safety net", () => {
  const skipLastStep = async () => {
    const session = createSingleAgentRefund({ chatId: "chat-net" });
    const run2 = async (name: keyof typeof session.tools, input: unknown) =>
      (await (
        session.tools[name] as unknown as {
          execute: (i: unknown, o: unknown) => Promise<unknown>;
        }
      ).execute(input, { toolCallId: "t", messages: [] })) as Record<
        string,
        unknown
      >;
    await run2("lookup_order", {
      orderId: "CSL-1001",
      email: "ada@example.com",
    });
    const check = await run2("check_refund_eligibility", details);
    return { session, caseId: check.caseId as string };
  };

  beforeEach(() => {
    store = createMemoryStore();
    vi.unstubAllEnvs();
  });

  it("hands a case the agent left unfinished to a person", async () => {
    const { session, caseId } = await skipLastStep();
    expect((await store.getCase(caseId))?.status).toBe("reviewing");
    await session.finish();
    expect((await store.getCase(caseId))?.status).toBe("escalated");
  });

  it("can be switched off to measure the agent without it", async () => {
    vi.stubEnv("ASK_COPPER_SAFETY_NET", "off");
    const { session, caseId } = await skipLastStep();
    await session.finish();
    expect((await store.getCase(caseId))?.status).toBe("reviewing");
  });
});

describe("single-agent instructions", () => {
  it("replace the hand-off with the refund steps and keep everything else", () => {
    expect(SINGLE_AGENT_INSTRUCTIONS).not.toContain("submit_refund_request");
    expect(SINGLE_AGENT_INSTRUCTIONS).toContain("lookup_order");
    expect(SINGLE_AGENT_INSTRUCTIONS).toContain("check_refund_eligibility");
    expect(SINGLE_AGENT_INSTRUCTIONS).toContain("get_refund_status");
    // The shopping and docs parts are word for word the same.
    const head = COPPER_INSTRUCTIONS.slice(
      0,
      COPPER_INSTRUCTIONS.indexOf("Refund requests."),
    );
    expect(SINGLE_AGENT_INSTRUCTIONS.startsWith(head)).toBe(true);
  });
});
