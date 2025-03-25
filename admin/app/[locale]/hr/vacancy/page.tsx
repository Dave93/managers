"use client";

import { DataTable } from "./data-table";
import { vacancyColumns } from "./columns";
import VacancyFormSheet from "@components/forms/vacancy/sheet";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus } from "lucide-react";
import CanAccess from "@admin/components/can-access";
import { VacancyFilters } from "./vacancy_filter";

export default function UsersListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Вакансии</h2>
        <div className="flex items-start space-x-2">
            <VacancyFilters />
           

        </div>
        
          <div className="flex items-center space-x-2">
            <CanAccess permission="vacancy.add">
              <VacancyFormSheet trigger={
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> Create
                </Button>
              } />
            </CanAccess>
          </div>
            </div>
      <div className="py-10">
        <DataTable columns={vacancyColumns} />
      </div>
    </div>
  );
}
