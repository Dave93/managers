import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@components/ui/sheet";
import CredentialsAddForm from "./_form";

export default function CredentialsAddFormSheet({
  children,
  recordId,
  model,
  credentialId,
}: {
  children: React.ReactNode;
  recordId: string;
  model: string;
  credentialId?: string;
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
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>
            {credentialId ? "Edit Credential" : "Add Credential"}
          </SheetTitle>
        </SheetHeader>
        {open && (
          <CredentialsAddForm
            recordId={recordId}
            model={model}
            credentialId={credentialId}
            setOpen={setOpen}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
