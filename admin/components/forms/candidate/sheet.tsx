import { Button } from "@admin/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@admin/components/ui/sheet";
import { Plus, Pencil } from "lucide-react";
import { useState } from "react";
import CandidateForm from "./_form";

export function CandidateSheet({
    recordId,
    trigger,
}: {
    recordId?: string;
    trigger?: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);

    const beforeOpen = async (open: boolean) => {
        if (open) {
            setOpen(true);
            if (recordId) {
            }
        } else {
            setOpen(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                {trigger || (
                    <Button>
                        {recordId ? (
                            <>
                                <Pencil className="mr-2 h-4 w-4" />
                                Редактировать
                            </>
                        ) : (
                            <>
                                <Plus className="mr-2 h-4 w-4" />
                                Создать
                            </>
                        )}
                    </Button>
                )}
            </SheetTrigger>
            <SheetContent className="sm:max-w-2xl overflow-y-auto">
                <SheetHeader className="mb-5">
                    <SheetTitle>
                        {recordId ? "Редактировать должность" : "Создать1 должность"}
                    </SheetTitle>
                    <SheetDescription>
                        Заполните форму ниже для {recordId ? "редактирования" : "создания"} должности
                    </SheetDescription>
                </SheetHeader>
                <div className="space-y-6">
                    <CandidateForm setOpen={setOpen} recordId={recordId} />
                </div>
            </SheetContent>
        </Sheet>
    );
}