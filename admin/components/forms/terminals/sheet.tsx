import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@components/ui/sheet";
import TerminalsForm from "./_form";

export default function TerminalsFormSheet({
  children,
  recordId,
}: {
  children: React.ReactNode;
  recordId?: string;
}) {
  const [open, setOpen] = useState<boolean>(false);

  const beforeOpen = async (open: boolean) => {
    if (open) {
      // Do something before the sheet opens.
      setOpen(true);
      if (recordId) {
        // const record = await trpc.permissions.one.query({ id: recordId });
        // form.setValue("active", record.active);
        // form.setValue("slug", record.slug);
        // form.setValue("description", record.description);
      }
    } else {
      setOpen(false);
    }
  };

  return (
    <Sheet onOpenChange={beforeOpen} open={open}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{"Edit"} Terminals</SheetTitle>
        </SheetHeader>
        {open && <TerminalsForm setOpen={setOpen} recordId={recordId} />}
      </SheetContent>
    </Sheet>
  );
}
