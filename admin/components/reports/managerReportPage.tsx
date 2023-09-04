import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@admin/components/ui/tabs";
import { CalendarReport } from "@admin/components/reports/calendar";

export default function ManagerReportPage() {
  return (
    <div className="container">
      <Tabs defaultValue="account" className="w-full pt-3">
        <TabsList className="w-full">
          <TabsTrigger value="title1" className="w-full">
            Les Ailes
          </TabsTrigger>
          <TabsTrigger value="title2" className="w-full">
            Chopar Pizza
          </TabsTrigger>
        </TabsList>
        <TabsContent value="title1">
          <CalendarReport />
        </TabsContent>
        <TabsContent value="title2">Change your password here.</TabsContent>
      </Tabs>
    </div>
  );
}
