"use client";
import { useParams } from "next/navigation";
import CanAccess from "@admin/components/can-access";
import { InterimDetail } from "../../reconciliation/_components/interim-detail";

export default function DailyReconciliationDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-3 pb-24 sm:p-4">
      <CanAccess permission="inventory.count">
        <InterimDetail id={id} readOnly backHref="/inventory/daily" />
      </CanAccess>
    </div>
  );
}
