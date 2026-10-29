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
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

interface StatusUpdateSheetProps {
    recordId: string;
    currentStatus?: string | null;
    currentComment?: string | null;
    trigger: React.ReactNode;
}

// Подписи — hangingOrders.processingStatus.<value>.
const statusOptions = [
    { value: "pending" },
    { value: "in_progress" },
    { value: "resolved" },
    { value: "cancelled" },
];

export function StatusUpdateSheet({
    recordId,
    currentStatus,
    currentComment,
    trigger,
}: StatusUpdateSheetProps) {
    const t = useTranslations("hangingOrders");
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
            toast.success(t("statusSheet.updated"));
            queryClient.invalidateQueries({ queryKey: ["hanging-orders"] });
            setOpen(false);
        },
        onError: (error) => {
            console.error("Error updating status:", error);
            toast.error(t("statusSheet.updateError"));
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
                    <SheetTitle>{t("statusSheet.title")}</SheetTitle>
                    <SheetDescription>
                        {t("statusSheet.description")}
                    </SheetDescription>
                </SheetHeader>
                
                <form onSubmit={handleSubmit} className="space-y-6 mt-6">
                    <div className="space-y-2">
                        <Label htmlFor="status">{t("statusSheet.statusLabel")}</Label>
                        <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger>
                                <SelectValue placeholder={t("statusSheet.statusPlaceholder")} />
                            </SelectTrigger>
                            <SelectContent>
                                {statusOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {t(`processingStatus.${option.value}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="comment">{t("statusSheet.commentLabel")}</Label>
                        <Textarea
                            id="comment"
                            placeholder={t("statusSheet.commentPlaceholder")}
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
                            {t("cancel")}
                        </Button>
                        <Button
                            type="submit"
                            disabled={updateStatusMutation.isPending}
                        >
                            {updateStatusMutation.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            {t("save")}
                        </Button>
                    </div>
                </form>
            </SheetContent>
        </Sheet>
    );
}