"use client";

import { DataTable } from "./data-table";
import { organizationsColumns } from "./columns";
import { Button } from "@components/ui/button";
import { Plus } from "lucide-react";
import OrganizationsFormSheet from "@admin/components/forms/organizations/sheet";
import CanAccess from "@admin/components/can-access";

export default function OrganizationsListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">
          Organizations List
        </h2>
        <div className="flex items-center space-x-2">
          <CanAccess permission="organizations.add">
            <OrganizationsFormSheet>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Create Organizations
              </Button>
            </OrganizationsFormSheet>
          </CanAccess>
        </div>
      </div>
      <div className="py-10">
        <DataTable columns={organizationsColumns} />
      </div>
    </div>
  );
}
