"use client";

import { DataTable } from "./data-table";
import { externalPartnersColumns } from "./columns";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus } from "lucide-react";
import ExternalPartnersFormSheet from "@admin/components/forms/external_partners/sheet";

export default function ExternalPartnersListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">External Partners</h2>
        <div className="flex items-center space-x-2">
          <ExternalPartnersFormSheet>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Create Partner
            </Button>
          </ExternalPartnersFormSheet>
        </div>
      </div>
      <div className="py-10">
        <DataTable columns={externalPartnersColumns} />
      </div>
    </div>
  );
}
