"use client";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@components/ui/alert-dialog";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiClient } from "@admin/utils/eden";
import { toast } from "sonner";

export default function DeleteAction({ recordId }: { recordId: string }) {
    const t = useTranslations("hrPages.schedule");
    const tc = useTranslations("forms.common");
    const queryClient = useQueryClient();

    const deleteMutation = useMutation({
        mutationFn: (id: string) => {
            return apiClient.api.work_schedule({ id }).delete();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["work_schedules"] });
            toast.success(t("deleted"));
        },
        onError: (error: any) => {
            toast.error(error.message);
        },
    });

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                    <Trash2 className="h-4 w-4" />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("deleteConfirmDescription")}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={() => deleteMutation.mutate(recordId)}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        {deleteMutation.isPending ? t("deleting") : tc("delete")}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
