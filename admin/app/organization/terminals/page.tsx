"use client";

import { DataTable } from "./data-table";
import { terminalsColumns } from "./columns";
import { Button } from "@components/ui/button";
import { Plus } from "lucide-react";
import TerminalsFormSheet from "@admin/components/forms/terminals/sheet";
import CanAccess from "@admin/components/can-access";

export default function TerminalsListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Terminals List</h2>
      </div>
      <div className="py-10">
        <DataTable columns={terminalsColumns} />
      </div>
    </div>
  );
}
