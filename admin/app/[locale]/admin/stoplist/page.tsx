"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";
import { DataTable } from "./data-table";
import { reportsColumns } from "./columns";
import { StoplistFilters } from "./stoplist_filters";

export default function ReportsListPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Stoplist</h2>
      </div>
      <StoplistFilters />
      <Tabs defaultValue="table" className="w-full">
        <TabsList>
          <TabsTrigger value="table">Таблицей</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        </TabsList>
        <TabsContent value="table">
          <div className="py-10">
            <DataTable columns={reportsColumns} />
          </div>
        </TabsContent>
        <TabsContent value="dashboard">
          {/* Dashboard content will go here */}
        </TabsContent>
      </Tabs>
    </div>
  );
}
