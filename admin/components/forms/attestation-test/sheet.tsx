import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@components/ui/sheet";
import { useTranslations } from "next-intl";
import AttestationTestForm from "./_form";

export default function AttestationTestFormSheet({
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
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto px-6 pb-8">
        <SheetHeader className="px-0 pt-6">
          <SheetTitle>{recordId ? t("tests.edit") : t("tests.add")}</SheetTitle>
        </SheetHeader>
        {open && <AttestationTestForm setOpen={setOpen} recordId={recordId} />}
      </SheetContent>
    </Sheet>
  );
}
