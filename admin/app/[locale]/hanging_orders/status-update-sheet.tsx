"use client";

import { useState } from "react";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@admin/components/ui/sheet";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@admin/components/ui/select";
import { Textarea } from "@admin/components/ui/textarea";
import { Label } from "@admin/components/ui/label";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface StatusUpdateSheetProps {
    recordId: string;
    currentStatus?: string | null;
    currentComment?: string | null;
    trigger: React.ReactNode;
}

const statusOptions = [
    { value: "pending", label: "В ожидании" },
    { value: "in_progress", label: "В работе" },
    { value: "resolved", label: "Решено" },
    { value: "cancelled", label: "Отменено" },
];

export function StatusUpdateSheet({
    recordId,
    currentStatus,
    currentComment,
    trigger,
}: StatusUpdateSheetProps) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState(currentStatus || "pending");
    const [comment, setComment] = useState(currentComment || "");
    
    const queryClient = useQueryClient();

    const updateStatusMutation = useMutation({
        mutationFn: async ({ status, comment }: { status: string; comment: string }) => {
            const { data } = await apiClient.api["hanging-orders"]({id: recordId}).status.patch({
                status,
                comment,
            });
            return data;
        },
        onSuccess: () => {
            toast.success("Статус успешно обновлен");
            queryClient.invalidateQueries({ queryKey: ["hanging-orders"] });
            setOpen(false);
        },
        onError: (error) => {
            console.error("Error updating status:", error);
            toast.error("Ошибка при обновлении статуса");
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        updateStatusMutation.mutate({ status, comment });
    };

    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen);
        if (newOpen) {
            // Reset form when opening
            setStatus(currentStatus || "pending");
            setComment(currentComment || "");
        }
    };

    return (
        <Sheet open={open} onOpenChange={handleOpenChange}>
            <SheetTrigger asChild>
                {trigger}
            </SheetTrigger>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>Обновить статус заказа</SheetTitle>
                    <SheetDescription>
                        Измените статус обработки и добавьте комментарий
                    </SheetDescription>
                </SheetHeader>
                
                <form onSubmit={handleSubmit} className="space-y-6 mt-6">
                    <div className="space-y-2">
                        <Label htmlFor="status">Статус обработки</Label>
                        <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger>
                                <SelectValue placeholder="Выберите статус" />
                            </SelectTrigger>
                            <SelectContent>
                                {statusOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="comment">Комментарий</Label>
                        <Textarea
                            id="comment"
                            placeholder="Добавьте комментарий по обработке заказа..."
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            rows={4}
                        />
                    </div>

                    <div className="flex justify-end space-x-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setOpen(false)}
                            disabled={updateStatusMutation.isPending}
                        >
                            Отмена
                        </Button>
                        <Button
                            type="submit"
                            disabled={updateStatusMutation.isPending}
                        >
                            {updateStatusMutation.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Сохранить
                        </Button>
                    </div>
                </form>
            </SheetContent>
        </Sheet>
    );
}