import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@components/ui/sheet";
import { List } from "lucide-react";
import { Button } from "@admin/components/ui/button";
import { DataTable } from "./reports-items-data-table";
import { reportsItemsColumns } from "./reports-items-columns";

export default function ReportItemsSheet({ recordId }: { recordId: string }) {
  const [open, setOpen] = useState<boolean>(false);

  const beforeOpen = async (open: boolean) => {
    if (open) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  return (
    <Sheet onOpenChange={beforeOpen} open={open}>
      <SheetTrigger asChild>
        <Button size="sm">
          <List className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-1/3 sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle asChild>
            <div className="flex justify-between mt-7 mb-4 items-center !text-2xl">
              <span>Позиции кассы</span>
            </div>
          </SheetTitle>
        </SheetHeader>
        {open && (
          <DataTable columns={reportsItemsColumns} recordId={recordId} />
        )}
      </SheetContent>
    </Sheet>
  );
}
