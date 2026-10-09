"use client";
import { useParams } from "next/navigation";
import CanAccess from "@admin/components/can-access";
import { InterimDetail } from "../../_components/interim-detail";

export default function InterimReconciliationPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="p-3 pb-24 sm:p-4">
      <CanAccess permission="inventory.reconcile">
        <InterimDetail id={id} />
      </CanAccess>
    </div>
  );
}
