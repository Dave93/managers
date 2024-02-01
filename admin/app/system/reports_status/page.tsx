"use client";

import { DataTable } from "./data-table";
import { reportsStatusColumns } from "./columns";
import { Button } from "@components/ui/button";
import { Plus } from "lucide-react";
import ReportsStatusFormSheet from "@admin/components/forms/reports_status/sheet";
import CanAccess from "@admin/components/can-access";

export default function ReportsStatusListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">
          Reports status List
        </h2>
        <div className="flex items-center space-x-2">
          <CanAccess permission="reports_status.add">
            <ReportsStatusFormSheet>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Create Report status
              </Button>
            </ReportsStatusFormSheet>
          </CanAccess>
        </div>
      </div>
      <div className="py-10">
        <DataTable columns={reportsStatusColumns} />
      </div>
    </div>
  );
}
