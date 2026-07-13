import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@components/ui/sheet";
import { useTranslations } from "next-intl";
import AttestationEmployeeForm from "./_form";

export default function AttestationEmployeeFormSheet({
  children,
  recordId,
}: {
  children: React.ReactNode;
  recordId?: string;
}) {
  const t = useTranslations("attestation");
  const [open, setOpen] = useState<boolean>(false);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {recordId ? t("employees.edit") : t("employees.add")}
          </SheetTitle>
        </SheetHeader>
        {open && <AttestationEmployeeForm setOpen={setOpen} recordId={recordId} />}
      </SheetContent>
    </Sheet>
  );
}
