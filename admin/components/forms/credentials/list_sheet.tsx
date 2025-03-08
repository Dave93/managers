import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@components/ui/sheet";
import { CredentialsList } from "./list";
import { credentialsColumns } from "./columns";
import { PlusIcon } from "lucide-react";
import CredentialsAddFormSheet from "./form_sheet";
import { Button } from "@admin/components/ui/buttonOrigin";

export default function CredentialsFormSheet({
  children,
  recordId,
  model,
}: {
  children: React.ReactNode;
  recordId: string;
  model: string;
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
      <SheetContent className="w-full sm:w-full max-w-3xl sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle asChild>
            <div className="flex justify-between my-7 items-center">
              <span>Credentials List</span>
              <CredentialsAddFormSheet recordId={recordId} model={model}>
                <Button size="sm">
                  <PlusIcon className="h-4 w-4" />
                  Add Credemtial
                </Button>
              </CredentialsAddFormSheet>
            </div>
          </SheetTitle>
        </SheetHeader>
        {open && (
          <CredentialsList
            recordId={recordId}
            model={model}
            columns={credentialsColumns}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
