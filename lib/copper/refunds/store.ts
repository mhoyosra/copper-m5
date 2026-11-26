import type { Actor } from "@/lib/copper/refunds/actor";
// Where orders, cases and the event log are kept. One interface, two
// implementations: the Supabase tables (production) and an in-memory copy
// seeded with demo orders (tests, and a local app with no Supabase set up).
import { createSupabaseStore } from "@/lib/copper/refunds/supabase-store";
import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import {
  type CaseEvent,
  type CaseStatus,
  LIVE_STATUSES,
  type Order,
  type RefundCase,
  type Subscription,
} from "@/lib/copper/refunds/types";

export type AttemptKind = "submission" | "failed_lookup";

export interface RefundStore {
  readonly kind: "memory" | "supabase";
  /** The order only if the id AND email match (email compared without case). */
  getOrder(orderId: string, email: string): Promise<Order | null>;
  getOrderById(orderId: string): Promise<Order | null>;
  /** Sum of this customer's auto-approved refunds since `since`. */
  autoRefundedSince(email: string, since: Date): Promise<number>;
  /** Inserts a case. If its line already has a live case, returns that one. */
  createCase(c: RefundCase): Promise<{ case: RefundCase; created: boolean }>;
  getCase(id: string): Promise<RefundCase | null>;
  casesForOrder(orderId: string): Promise<RefundCase[]>;
  listCases(statuses: CaseStatus[]): Promise<RefundCase[]>;
  /** Changes a case only if it is still in `from`. Returns the new case, or null. */
  transition(
    id: string,
    from: CaseStatus[],
    patch: Partial<RefundCase>,
  ): Promise<RefundCase | null>;
  /**
   * All or nothing: marks the case refunded, adds the amount to the line, and
   * ends the subscription when `endsPlan`. Returns null if the case wasn't in
   * one of the `from` states.
   */
  applyRefund(args: {
    caseId: string;
    from: CaseStatus[];
    decidedBy: Actor;
  }): Promise<RefundCase | null>;
  addEvent(e: CaseEvent): Promise<void>;
  events(caseId: string): Promise<CaseEvent[]>;
  recordAttempt(kind: AttemptKind, key: string): Promise<void>;
  countAttempts(kind: AttemptKind, key: string, since: Date): Promise<number>;
  subscriptionFor(orderId: string): Promise<Subscription | null>;
}

// --------------------------------------------------------------------------
// In-memory store
// --------------------------------------------------------------------------

type Data = {
  orders: Order[];
  subscriptions: Subscription[];
  cases: RefundCase[];
  events: CaseEvent[];
  attempts: { kind: AttemptKind; key: string; at: number }[];
};

const day = (offset: number, now: Date) =>
  new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10);

/** Demo orders (fictional), dated relative to `now` so the windows always work. */
export function demoData(
  now: Date = new Date(),
): Pick<Data, "orders" | "subscriptions"> {
  const line = (
    id: string,
    orderId: string,
    over: Partial<Order["lines"][number]>,
  ): Order["lines"][number] => ({
    id,
    orderId,
    item: "copper-home",
    kind: "device",
    plan: null,
    amountUsd: 149,
    chargedAt: day(12, now),
    deliveredAt: day(10, now),
    billingPeriod: null,
    refundedUsd: 0,
    subscriptionId: null,
    ...over,
  });
  const month = (offset: number) => day(offset, now).slice(0, 7);
  const orders: Order[] = [
    {
      id: "CSL-1001",
      email: "ada@example.com",
      lines: [line("L-1001-1", "CSL-1001", {})],
    },
    {
      id: "CSL-1002",
      email: "ben@example.com",
      lines: [
        line("L-1002-1", "CSL-1002", {
          item: "copper-notes",
          amountUsd: 129,
          chargedAt: day(50, now),
          deliveredAt: day(45, now),
        }),
      ],
    },
    {
      id: "CSL-1003",
      email: "cara@example.com",
      lines: [
        line("L-1003-1", "CSL-1003", {
          item: "copper-plus",
          kind: "service",
          plan: "annual",
          amountUsd: 79,
          chargedAt: day(5, now),
          deliveredAt: null,
          subscriptionId: "S-1003",
        }),
      ],
    },
    {
      id: "CSL-1004",
      email: "dan@example.com",
      lines: [
        line("L-1004-1", "CSL-1004", {
          item: "copper-plus",
          kind: "service",
          plan: "annual",
          amountUsd: 79,
          chargedAt: day(30, now),
          deliveredAt: null,
          subscriptionId: "S-1004",
        }),
      ],
    },
    {
      id: "CSL-1005",
      email: "eve@example.com",
      lines: [
        line("L-1005-1", "CSL-1005", {
          item: "copper-plus",
          kind: "service",
          plan: "monthly",
          amountUsd: 7.99,
          chargedAt: day(3, now),
          deliveredAt: null,
          billingPeriod: month(3),
          subscriptionId: "S-1005",
        }),
        line("L-1005-2", "CSL-1005", {
          item: "copper-plus",
          kind: "service",
          plan: "monthly",
          amountUsd: 7.99,
          chargedAt: day(3, now),
          deliveredAt: null,
          billingPeriod: month(3),
          subscriptionId: "S-1005",
        }),
      ],
    },
    {
      id: "CSL-1006",
      email: "fay@example.com",
      lines: [
        line("L-1006-1", "CSL-1006", {
          item: "copper-plus",
          kind: "service",
          plan: "monthly",
          amountUsd: 7.99,
          chargedAt: day(2, now),
          deliveredAt: null,
          billingPeriod: month(2),
          subscriptionId: "S-1006",
        }),
      ],
    },
    {
      id: "CSL-1007",
      email: "gus@example.com",
      lines: [
        line("L-1007-1", "CSL-1007", {
          item: "copper-plus",
          kind: "service",
          plan: "free",
          amountUsd: 0,
          chargedAt: day(20, now),
          deliveredAt: null,
          subscriptionId: "S-1007",
        }),
      ],
    },
    {
      id: "CSL-1008",
      email: "hal@example.com",
      lines: [
        line("L-1008-1", "CSL-1008", {
          item: "copper-plus",
          kind: "service",
          plan: "monthly",
          amountUsd: 7.99,
          chargedAt: day(60, now),
          deliveredAt: null,
          billingPeriod: month(60),
          subscriptionId: "S-1008",
        }),
        line("L-1008-2", "CSL-1008", {
          item: "copper-plus",
          kind: "service",
          plan: "monthly",
          amountUsd: 7.99,
          chargedAt: day(30, now),
          deliveredAt: null,
          billingPeriod: month(30),
          subscriptionId: "S-1008",
        }),
        line("L-1008-3", "CSL-1008", {
          item: "copper-plus",
          kind: "service",
          plan: "monthly",
          amountUsd: 7.99,
          chargedAt: day(1, now),
          deliveredAt: null,
          billingPeriod: month(1),
          subscriptionId: "S-1008",
        }),
      ],
    },
  ];
  const subscriptions: Subscription[] = [
    {
      id: "S-1003",
      orderId: "CSL-1003",
      plan: "annual",
      status: "active",
      endedAt: null,
    },
    {
      id: "S-1004",
      orderId: "CSL-1004",
      plan: "annual",
      status: "active",
      endedAt: null,
    },
    {
      id: "S-1005",
      orderId: "CSL-1005",
      plan: "monthly",
      status: "active",
      endedAt: null,
    },
    {
      id: "S-1006",
      orderId: "CSL-1006",
      plan: "monthly",
      status: "active",
      endedAt: null,
    },
    {
      id: "S-1007",
      orderId: "CSL-1007",
      plan: "free",
      status: "active",
      endedAt: null,
    },
    {
      id: "S-1008",
      orderId: "CSL-1008",
      plan: "monthly",
      status: "active",
      endedAt: null,
    },
  ];
  return { orders, subscriptions };
}

export function createMemoryStore(seed?: Partial<Data>): RefundStore {
  const demo = demoData();
  const data: Data = structuredClone({
    orders: seed?.orders ?? demo.orders,
    subscriptions: seed?.subscriptions ?? demo.subscriptions,
    cases: seed?.cases ?? [],
    events: seed?.events ?? [],
    attempts: seed?.attempts ?? [],
  });
  const clone = <T>(v: T): T => structuredClone(v);
  const isLive = (c: RefundCase) => LIVE_STATUSES.includes(c.status);

  return {
    kind: "memory",
    async getOrder(orderId, email) {
      const o = data.orders.find(
        (x) =>
          x.id === orderId && x.email.toLowerCase() === email.toLowerCase(),
      );
      return o ? clone(o) : null;
    },
    async getOrderById(orderId) {
      const o = data.orders.find((x) => x.id === orderId);
      return o ? clone(o) : null;
    },
    async autoRefundedSince(email, since) {
      return data.cases
        .filter(
          (c) =>
            c.email.toLowerCase() === email.toLowerCase() &&
            c.autoApproved &&
            (c.status === "refunded" || c.status === "awaiting_return") &&
            Date.parse(c.decidedAt ?? c.requestedAt) >= since.getTime(),
        )
        .reduce((sum, c) => sum + (c.amountUsd ?? 0), 0);
    },
    async createCase(c) {
      if (c.lineId) {
        const existing = data.cases.find(
          (x) => x.lineId === c.lineId && isLive(x),
        );
        if (existing) return { case: clone(existing), created: false };
      }
      data.cases.push(clone(c));
      return { case: clone(c), created: true };
    },
    async getCase(id) {
      const c = data.cases.find((x) => x.id === id);
      return c ? clone(c) : null;
    },
    async casesForOrder(orderId) {
      return clone(data.cases.filter((c) => c.orderId === orderId));
    },
    async listCases(statuses) {
      return clone(data.cases.filter((c) => statuses.includes(c.status)));
    },
    async transition(id, from, patch) {
      const c = data.cases.find((x) => x.id === id);
      if (!c || !from.includes(c.status)) return null;
      Object.assign(c, patch);
      return clone(c);
    },
    async applyRefund({ caseId, from, decidedBy }) {
      const c = data.cases.find((x) => x.id === caseId);
      if (!c || !from.includes(c.status) || !c.lineId || c.amountUsd === null)
        return null;
      const order = data.orders.find((o) => o.id === c.orderId);
      const line = order?.lines.find((l) => l.id === c.lineId);
      if (!line) return null;
      line.refundedUsd =
        Math.round((line.refundedUsd + c.amountUsd) * 100) / 100;
      if (c.endsPlan && line.subscriptionId) {
        const sub = data.subscriptions.find(
          (s) => s.id === line.subscriptionId,
        );
        if (sub) {
          sub.status = "ended";
          sub.endedAt = new Date().toISOString();
        }
      }
      c.status = "refunded";
      c.decidedBy = decidedBy;
      c.decidedAt = new Date().toISOString();
      return clone(c);
    },
    async addEvent(e) {
      data.events.push(clone(e));
    },
    async events(caseId) {
      return clone(data.events.filter((e) => e.caseId === caseId));
    },
    async recordAttempt(kind, key) {
      data.attempts.push({ kind, key: key.toLowerCase(), at: Date.now() });
    },
    async countAttempts(kind, key, since) {
      return data.attempts.filter(
        (a) =>
          a.kind === kind &&
          a.key === key.toLowerCase() &&
          a.at >= since.getTime(),
      ).length;
    },
    async subscriptionFor(orderId) {
      const s = data.subscriptions.find((x) => x.orderId === orderId);
      return s ? clone(s) : null;
    },
  };
}

// --------------------------------------------------------------------------
// Which store the app uses
// --------------------------------------------------------------------------

const globalForStore = globalThis as unknown as { __refundStore?: RefundStore };

/**
 * The Supabase store when it is set up, else an in-memory demo store that
 * lives as long as the server does (so the local app works with no setup).
 */
export function getStore(): RefundStore {
  if (isSupabaseAdminConfigured()) return createSupabaseStore();
  globalForStore.__refundStore ??= createMemoryStore();
  return globalForStore.__refundStore;
}

/**
 * Starts the demo store over with the seed orders and no cases. Only the
 * in-memory store can be reset: with Supabase configured this does nothing and
 * returns false, so an eval can never touch real cases.
 */
export function resetDemoStore(): boolean {
  if (isSupabaseAdminConfigured()) return false;
  globalForStore.__refundStore = createMemoryStore();
  return true;
}
