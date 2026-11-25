import { connection } from "next/server";
import { Suspense } from "react";
import { AskCopper } from "@/components/copper/ask-copper";
import {
  CaseActions,
  type CaseKind,
} from "@/components/copper/refund-console/case-actions";
import { ConsoleAutoRefresh } from "@/components/copper/refund-console/auto-refresh";
import { SiteFooter } from "@/components/copper/site-footer";
import { SiteHeader } from "@/components/copper/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isAiConfigured } from "@/lib/ai/call";
import { formatUsd } from "@/lib/copper/catalog";
import { reviewReasonText } from "@/lib/copper/refunds/decision";
import { getStore } from "@/lib/copper/refunds/store";
import type { CaseStatus, RefundCase } from "@/lib/copper/refunds/types";

export const metadata = { title: "Refund Console | Copper State Labs" };

export default function SupportPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold">Refund Console</h1>
          <p className="text-muted-foreground">
            Refunds the Refund Agent handed to a person, and returned devices
            waiting to be marked received. Ask Copper is at the bottom right.
          </p>
        </div>
        <Suspense fallback={<Skeleton className="h-48 w-full" />}>
          <Console />
        </Suspense>
      </main>
      <SiteFooter />
      <ConsoleAutoRefresh />
      <Suspense fallback={null}>
        <AskCopper aiConfigured={isAiConfigured()} />
      </Suspense>
    </>
  );
}

const KIND_LABEL: Record<string, string> = {
  device: "Device",
  service: "Subscription",
};

const STATUS_LABEL: Record<CaseStatus, string> = {
  reviewing: "Reviewing",
  escalated: "Needs a decision",
  awaiting_return: "Waiting for the device",
  refunded: "Refunded",
  rejected: "Rejected by policy",
  declined: "Rejected by a person",
  handled_elsewhere: "Handled outside the system",
};

async function Console() {
  await connection();
  const store = getStore();
  const [escalated, waiting, decided] = await Promise.all([
    store.listCases(["escalated"]),
    store.listCases(["awaiting_return"]),
    store.listCases(["refunded", "rejected", "declined", "handled_elsewhere"]),
  ]);
  const recent = [...decided]
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .slice(0, 8);

  return (
    <div className="space-y-8">
      {store.kind === "memory" && (
        <p
          data-testid="demo-banner"
          className="bg-muted rounded-lg border px-4 py-3 text-sm"
        >
          Demo data: these orders and cases live in memory and reset when the
          server restarts. Set up Supabase to keep them. This console has no
          sign-in yet, so don&apos;t use it for real refunds.
        </p>
      )}
      <Section
        title="Needs a decision"
        cases={escalated}
        empty="Nothing waiting."
      >
        {(c) => (
          <CaseActions
            caseId={c.id}
            kind={actionKind(c)}
            endsPlan={c.endsPlan}
            requiresReturn={c.requiresReturn}
          />
        )}
      </Section>
      <Section
        title="Waiting for the device"
        cases={waiting}
        empty="No devices on the way back."
      >
        {(c) => (
          <CaseActions
            caseId={c.id}
            kind="received"
            endsPlan={false}
            requiresReturn
          />
        )}
      </Section>
      <Section
        title="Recently decided"
        cases={recent}
        empty="Nothing decided yet."
      />
    </div>
  );
}

function actionKind(c: RefundCase): CaseKind {
  return c.policyEligible ? "approve" : "exception";
}

function Section({
  title,
  cases,
  empty,
  children,
}: {
  title: string;
  cases: RefundCase[];
  empty: string;
  children?: (c: RefundCase) => React.ReactNode;
}) {
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="text-lg font-semibold">
        {title} <span className="text-muted-foreground">({cases.length})</span>
      </h2>
      {cases.length === 0 && (
        <p className="text-muted-foreground text-sm">{empty}</p>
      )}
      {cases.map((c) => (
        <CaseCard key={c.id} c={c}>
          {children?.(c)}
        </CaseCard>
      ))}
    </section>
  );
}

function CaseCard({
  c,
  children,
}: {
  c: RefundCase;
  children?: React.ReactNode;
}) {
  return (
    <Card data-testid="case-card" data-case-id={c.id}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">
          {c.orderId} · {c.item}
          {c.amountUsd !== null && ` · ${formatUsd(c.amountUsd)}`}
        </CardTitle>
        <div className="flex gap-2">
          {c.kind && <Badge variant="outline">{KIND_LABEL[c.kind]}</Badge>}
          <Badge>{STATUS_LABEL[c.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Rule</dt>
          <dd className="font-mono text-xs">{c.ruleApplied}</dd>
          <dt className="text-muted-foreground">Reason</dt>
          <dd>{c.reasonCode.replace("_", " ")}</dd>
          <dt className="text-muted-foreground">Asked</dt>
          <dd>{new Date(c.requestedAt).toISOString().slice(0, 10)}</dd>
          <dt className="text-muted-foreground">Case</dt>
          <dd className="font-mono text-xs">{c.id}</dd>
        </dl>
        {c.customerMessage && (
          <blockquote className="border-l-2 pl-3 italic">
            {/* Plain text only: a customer's words are never rendered as HTML. */}
            {c.customerMessage}
          </blockquote>
        )}
        {(c.status === "escalated" || c.status === "reviewing") && (
          <p data-testid="review-reason">
            <span className="text-muted-foreground">
              Why a person is needed:{" "}
            </span>
            {reviewReasonText(c)}
          </p>
        )}
        {c.summary && (
          <p className="text-muted-foreground">
            Refund Agent&apos;s note (the agent&apos;s own words, not verified):{" "}
            {c.summary}
          </p>
        )}
        {c.note && (
          <p className="text-muted-foreground">
            Reviewer&apos;s note: {c.note}
          </p>
        )}
        {children}
      </CardContent>
    </Card>
  );
}
