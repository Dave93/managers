"use client";

import { WorkScheduleFormSheet } from "@admin/components/forms/schedule/sheet";
import { DataTable } from "./data-table";
import { sheduleColumns } from "./columns";
import { Button } from "@components/ui/button";
import { Plus } from "lucide-react";
import CanAccess from "@admin/components/can-access";


export default function UsersListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">График работы</h2>
        <div className="flex items-center space-x-2">
          <CanAccess permission="positions.add">
            <WorkScheduleFormSheet />
          </CanAccess>
        </div>
      </div>
      <div className="py-10">
        <DataTable columns={sheduleColumns} />
      </div>
    </div>
  );
}
