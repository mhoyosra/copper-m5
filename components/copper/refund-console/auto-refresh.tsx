"use client";

// Reloads the Refund Console's data when Ask Copper finishes a refund request,
// so a new case shows up without refreshing the page.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export const REFUND_CHANGED_EVENT = "copper:refund-changed";

export function ConsoleAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener(REFUND_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(REFUND_CHANGED_EVENT, refresh);
  }, [router]);
  return null;
}
