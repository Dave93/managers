import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@components/ui/dialog";
import { Drawer, DrawerContent, DrawerTrigger } from "@components/ui/drawer";
import { SheetHeader, SheetTitle } from "@components/ui/sheet";
import VacancyForm from "./_form";
import { useMediaQuery } from "@admin/lib/hooks";

export default function VacancyFormSheet({
    children,
    recordId,
}: {
    children: React.ReactNode;
    recordId?: string;
}) {
    const [open, setOpen] = useState<boolean>(false);
    const isDesktop = useMediaQuery("(min-width: 768px)");

    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen);
    };

    if (isDesktop) {
        return (
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogTrigger asChild>{children}</DialogTrigger>
                <DialogContent className="sm:max-w-[1000px]">
                    <SheetHeader>
                        <SheetTitle>{recordId ? "Редактировать" : "Добавить"} вакансию</SheetTitle>
                    </SheetHeader>
                    {open && <VacancyForm setOpen={setOpen} recordId={recordId} />}
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Drawer open={open} onOpenChange={handleOpenChange}>
            <DrawerTrigger asChild>{children}</DrawerTrigger>
            <DrawerContent className="px-3">
                <SheetHeader>
                    <SheetTitle>{recordId ? "Редактировать" : "Добавить"} вакансию</SheetTitle>
                </SheetHeader>
                {open && <VacancyForm setOpen={setOpen} recordId={recordId} />}
            </DrawerContent>
        </Drawer>
    );
}
