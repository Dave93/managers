import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@admin/components/ui/tabs";
import { CalendarReport } from "@admin/components/reports/calendar";
import { trpc } from "@admin/utils/trpc";

export default function ManagerReportPage() {
  const { data: terminalsList, isLoading: isTerminalsLoading } =
    trpc.usersTerminals.getMyTerminals.useQuery();

  return (
    <div className="container">
      <Tabs defaultValue="account" className="w-full pt-3">
        <TabsList className="w-full">
          {terminalsList?.map((terminal) => (
            <TabsTrigger
              value={terminal.terminal_id}
              key={terminal.terminal_id}
              className="w-full"
            >
              {terminal.terminals.name}
            </TabsTrigger>
          ))}
        </TabsList>
        {terminalsList?.map((terminal) => (
          <TabsContent value={terminal.terminal_id} key={terminal.terminal_id}>
            <CalendarReport terminalId={terminal.terminal_id} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
