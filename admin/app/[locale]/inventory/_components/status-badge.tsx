"use client";
import { useTranslations } from "next-intl";
import { Badge } from "@admin/components/ui/badge";
import type { InventoryCountStatus } from "@backend/modules/inventory/types";

const VARIANT: Record<InventoryCountStatus, "default" | "secondary" | "outline"> = {
  draft: "secondary",
  submitted: "default",
  cancelled: "outline",
};

export function StatusBadge({ status }: { status: InventoryCountStatus }) {
  const t = useTranslations("inventory.status");
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
