import { Button } from "@admin/components/ui/buttonOrigin";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@admin/components/ui/sheet";
import { Plus, Pencil } from "lucide-react";
import PositionsForm from "./_form";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

// Добавляем функцию для отладки
const debugLog = (message: string, data: any) => {
    console.log(`[PositionsSheet] ${message}:`, data);
};

export function PositionsSheet({
    recordId,
    trigger,
}: {
    recordId?: string;
    trigger?: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const queryClient = useQueryClient();

    const handleOpenChange = (newOpen: boolean) => {
        if (newOpen) {
            // Если открываем форму редактирования, инвалидируем запрос
            if (recordId) {
                queryClient.invalidateQueries({ queryKey: ["one_position", recordId] });
            }
            setOpen(true);
        } else {
            setOpen(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={handleOpenChange}>
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
                        {recordId ? "Редактировать должность" : "Создать должность"}
                    </SheetTitle>
                    <SheetDescription>
                        Заполните форму ниже для {recordId ? "редактирования" : "создания"} должности
                    </SheetDescription>
                </SheetHeader>
                <div className="space-y-6">
                    <PositionsForm setOpen={setOpen} recordId={recordId} />
                </div>
            </SheetContent>
        </Sheet>
    );
}