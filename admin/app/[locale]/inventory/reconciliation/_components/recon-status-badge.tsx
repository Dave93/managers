"use client";
import { useTranslations } from "next-intl";
import { Badge } from "@admin/components/ui/badge";
import type { ReconStatus } from "@backend/modules/inventory/reconcile/types";

const VARIANT: Record<ReconStatus, "default" | "secondary" | "outline" | "destructive"> = {
  waiting_iiko: "outline",
  needs_choice: "destructive",
  ready: "secondary",
  in_review: "default",
  accepted: "outline",
};

export function ReconStatusBadge({ status }: { status: ReconStatus }) {
  const t = useTranslations("inventory.reconcile.status");
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
