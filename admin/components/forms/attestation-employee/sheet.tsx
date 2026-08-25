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
  terminalId,
}: {
  children: React.ReactNode;
  recordId?: string;
  /** Филиал, подставленный вызывающим экраном («Состав филиалов» открывает
   *  форму прямо с карточки). Не передан — форма ведёт себя как раньше и
   *  просит выбрать филиал из списка на 72 позиции. */
  terminalId?: string;
}) {
  const t = useTranslations("attestation");
  const [open, setOpen] = useState<boolean>(false);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto px-6 pb-8">
        <SheetHeader className="px-0 pt-6">
          <SheetTitle>
            {recordId ? t("employees.edit") : t("employees.add")}
          </SheetTitle>
        </SheetHeader>
        {open && (
          <AttestationEmployeeForm
            setOpen={setOpen}
            recordId={recordId}
            terminalId={terminalId}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
