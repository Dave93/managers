import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@components/ui/sheet";
import CreditCompaniesForm from "./_form";

export default function CreditCompaniesFormSheet({
  children,
  recordId,
}: {
  children: React.ReactNode;
  recordId?: string;
}) {
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
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{recordId ? "Редактировать" : "Добавить"} кредитную компанию</SheetTitle>
        </SheetHeader>
        <CreditCompaniesForm setOpen={setOpen} recordId={recordId} />
      </SheetContent>
    </Sheet>
  );
}
