"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { SelectClearable, SelectItem, SelectContent, SelectValue, SelectTriggerClearable } from "@admin/components/ui/select-clearable";
import { useReportsStatusesFilter } from "./reports-statuses.hook";

export default function ReportsStatusesFilter() {
  const [selectedStatus, setSelectedStatus] = useReportsStatusesFilter();

  const { data, isLoading } = useQuery({
    queryKey: [
      "filter_reports_statuses"
    ],
    queryFn: async () => {
      const { data } = await apiClient.api.reports_status.cached.get();
      return data;
    },
  });


  return (
    <SelectClearable onValueChange={setSelectedStatus} value={selectedStatus ?? undefined} >
      <SelectTriggerClearable className="w-44" showClear onClear={() => setSelectedStatus('')}>
        <SelectValue placeholder="Выберите статус" />
      </SelectTriggerClearable>
      <SelectContent>
        {data &&
          Array.isArray(data) &&
          data.map((item) => (
            <SelectItem value={item.id} key={item.id}>
              {item.label}
            </SelectItem>
          ))}
      </SelectContent>
    </SelectClearable>
  );
}
