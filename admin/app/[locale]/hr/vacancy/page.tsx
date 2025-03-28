"use client";

import { DataTable } from "./data-table";
import { vacancyColumns } from "./columns";
import VacancyFormSheet from "@components/forms/vacancy/sheet";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus, Users } from "lucide-react";
import CanAccess from "@admin/components/can-access";
import { VacancyFilters } from "./vacancy_filter";
import { Card, CardContent, CardHeader, CardTitle } from "@admin/components/ui/card";
import { useState, useEffect } from "react";
import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";

// Component to display vacancy and candidate statistics
// const VacancyStats = () => {
//   const { data, isLoading } = useQuery({
//     queryKey: ["vacancy-stats"],
//     queryFn: async () => {
//       const { data } = await apiClient.api.vacancy.get({
//         query: {
//           limit: "1000",
//           offset: "0",
//         },
//       });
//       return data;
//     },
//   });

//   const totalVacancies = data?.total || 0;
//   const totalCandidates = data?.data?.reduce((sum: number, vacancy: any) => sum + (vacancy.candidatesCount || 0), 0) || 0;
//   const averageCandidates = totalVacancies ? (totalCandidates / totalVacancies).toFixed(1) : 0;

//   return (
//     <div className="grid gap-4 md:grid-cols-3 mb-6">
//       <Card>
//         <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
//           <CardTitle className="text-sm font-medium">Всего вакансий</CardTitle>
//         </CardHeader>
//         <CardContent>
//           <div className="text-2xl font-bold">{totalVacancies}</div>
//         </CardContent>
//       </Card>
//       <Card>
//         <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
//           <CardTitle className="text-sm font-medium">Всего кандидатов</CardTitle>
//           <Users className="h-4 w-4 text-muted-foreground" />
//         </CardHeader>
//         <CardContent>
//           <div className="text-2xl font-bold">{totalCandidates}</div>
//         </CardContent>
//       </Card>
//       <Card>
//         <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
//           <CardTitle className="text-sm font-medium">Кандидатов на вакансию</CardTitle>
//         </CardHeader>
//         <CardContent>
//           <div className="text-2xl font-bold">{averageCandidates}</div>
//         </CardContent>
//       </Card>
//     </div>
//   );
// };

export default function UsersListPage() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Вакансии</h2>
        
        
          <div className="flex items-center space-x-2">
            <CanAccess permission="vacancy.add">
              <VacancyFormSheet trigger={
                <Button>
                  <Plus className="h-4 w-4" />Create
                </Button>
              } />
            </CanAccess>
          </div>
      </div>
      <div className="flex space-x-2">
            <VacancyFilters />
      </div>
      {/* <VacancyStats /> */}
      
      <div className="py-4">
        <DataTable columns={vacancyColumns} />
      </div>
    </div>
  );
}
