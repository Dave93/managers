import { Trash2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import { toast } from "sonner";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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

export default function DeleteAction({ recordId }: { recordId: string }) {
    const t = useTranslations("hrPages.vacancy");
    const tc = useTranslations("forms.common");
    const queryClient = useQueryClient();

    const deleteMutation = useMutation({
        mutationFn: async () => {
            return apiClient.api.vacancy({ id: recordId }).delete();
        },
        onSuccess: () => {
            toast.success(t("deleted"));
            queryClient.invalidateQueries({ queryKey: ["vacancy"] });
        },
        onError: (error: any) => {
            toast.error(error.message);
        },
    });

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                    <Trash2Icon className="h-4 w-4" />
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
                        onClick={() => deleteMutation.mutate()}
                        disabled={deleteMutation.isPending}
                    >
                        {deleteMutation.isPending ? t("deleting") : tc("delete")}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
} 