import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@components/ui/sheet";
import { Drawer, DrawerContent, DrawerTrigger } from "@components/ui/drawer";
import { Dialog, DialogContent, DialogTrigger } from "@components/ui/dialog";
import UsersForm from "./_form";
import { useMediaQuery } from "@admin/lib/hooks";

export default function UsersFormSheet({
  children,
  recordId,
}: {
  children: React.ReactNode;
  recordId?: string;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const beforeOpen = async (open: boolean) => {
    if (open) {
      setOpen(true);
      if (recordId) {
      }
    } else {
      setOpen(false);
    }
  };

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          {open && <UsersForm setOpen={setOpen} recordId={recordId} />}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent className="px-3">
        {open && <UsersForm setOpen={setOpen} recordId={recordId} />}
      </DrawerContent>
    </Drawer>
  );

  return (
    <Sheet onOpenChange={beforeOpen} open={open}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{recordId ? "Edit" : "Add"} Users</SheetTitle>
        </SheetHeader>
        {open && <UsersForm setOpen={setOpen} recordId={recordId} />}
      </SheetContent>
    </Sheet>
  );
}
