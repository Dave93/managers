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
  onSaved,
}: {
  children: React.ReactNode;
  recordId?: string;
  // Fires after a successful create/update, in addition to the form's own
  // ["credit_companies"] (list) invalidation — lets callers outside the list
  // page (e.g. the company detail page, keyed off ["credit_company", id])
  // refresh their own query too, without this component knowing about them.
  onSaved?: () => void;
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
        <CreditCompaniesForm setOpen={setOpen} recordId={recordId} onSaved={onSaved} />
      </SheetContent>
    </Sheet>
  );
}
