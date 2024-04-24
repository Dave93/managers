import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@admin/components/ui/tabs";
import { CalendarReport } from "@admin/components/reports/calendar";
import { useMemo } from "react";
import useToken from "@admin/store/get-token";
import { useQueries } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";

export default function ManagerReportPage() {
  const token = useToken();

  const [
    { data: terminalsList, isLoading: isTerminalsLoading },
    { data: reportsStatus, isLoading: isReportsStatusLoading },
  ] = useQueries({
    queries: [
      {
        queryKey: ["users_terminals"],
        queryFn: async () => {
          const { data } = await apiClient.api.users_terminals.my_terminals.get(
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );
          return data;
        },
        enabled: !!token,
      },
      {
        enabled: !!token,
        queryKey: ["reports_status"],
        queryFn: async () => {
          const { data } = await apiClient.api.reports_status.cached.get({
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          return data;
        },
      },
    ],
  });

  const isLoadingData = useMemo(() => {
    return isTerminalsLoading || isReportsStatusLoading;
  }, [isTerminalsLoading, isReportsStatusLoading]);

  return (
    <div className="container">
      {isLoadingData ? (
        <div className="flex w-full h-[calc(100dvh-100px)] items-center justify-around">
          <svg
            className="animate-spin h-10 w-10 text-sky-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        </div>
      ) : (
        <div>
          <Tabs defaultValue="account" className="w-full pt-3">
            <TabsList className="w-full">
              {terminalsList &&
                Array.isArray(terminalsList.data) &&
                terminalsList.data.map((terminal) => (
                  <TabsTrigger
                    value={terminal.terminal_id}
                    key={terminal.terminal_id}
                    className="w-full"
                  >
                    {terminal.terminals.name}
                  </TabsTrigger>
                ))}
            </TabsList>
            {terminalsList &&
              Array.isArray(terminalsList.data) &&
              terminalsList.data.map((terminal) => (
                <TabsContent
                  value={terminal.terminal_id}
                  key={terminal.terminal_id}
                >
                  <CalendarReport
                    terminalId={terminal.terminal_id}
                    reportsStatus={
                      reportsStatus && Array.isArray(reportsStatus)
                        ? reportsStatus
                        : []
                    }
                  />
                </TabsContent>
              ))}
          </Tabs>
          <div className="mt-6">
            <div className="text-2xl font-bold border-b-2">Статусы</div>
            <div className="space-y-2 mt-4">
              {reportsStatus &&
                Array.isArray(reportsStatus) &&
                reportsStatus.map((status) => (
                  <div key={status.id} className="flex space-x-3 items-center">
                    <div
                      className="h-5 w-5 rounded-full"
                      style={{
                        backgroundColor: status.color,
                      }}
                    ></div>
                    <div className="uppercase">{status.label}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
