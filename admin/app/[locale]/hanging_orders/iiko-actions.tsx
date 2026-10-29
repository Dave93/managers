"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
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
} from "@admin/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@admin/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@admin/components/ui/select";
import { Textarea } from "@admin/components/ui/textarea";
import { Label } from "@admin/components/ui/label";

type Record = {
    id: string;
    brand: string;
    orderStatus: string | null;
    receiptNumber: string | null;
    amount: string | null;
    conception: string | null;
};

type Option = { id: string; name: string };

const describe = (t: (key: string, values?: { [name: string]: string | number }) => string, r: Record) =>
    [
        r.conception,
        r.receiptNumber ? t("iikoActions.receipt", { number: r.receiptNumber }) : null,
        r.amount ? t("columns.amountValue", { amount: Number(r.amount).toLocaleString("ru-RU") }) : null,
    ]
        .filter(Boolean)
        .join(" · ");

/**
 * Закрыть и отменить заказ в iiko. Показывается только при праве
 * hanging_orders.iiko_actions (роль admin) — обёртка CanAccess в колонке.
 */
export function IikoActions({ record }: { record: Record }) {
    const t = useTranslations("hangingOrders");
    const queryClient = useQueryClient();
    const [cancelOpen, setCancelOpen] = useState(false);
    const [causeId, setCauseId] = useState("");
    const [removalId, setRemovalId] = useState("");
    const [comment, setComment] = useState("");

    const report = (result: { data?: unknown; error?: { value?: unknown } | null }, done: string) => {
        const err = result.error?.value as { message?: string } | undefined;
        const body = result.data as { data?: { state?: string; message?: string }; message?: string } | undefined;

        if (err?.message) {
            toast.error(err.message);
        } else if (body?.data?.state === "InProgress") {
            toast.warning(body.message ?? t("iikoActions.inProgress"));
        } else {
            toast.success(body?.data?.message ?? done);
        }
        queryClient.invalidateQueries({ queryKey: ["hanging-orders"] });
    };

    const close = useMutation({
        mutationFn: () => apiClient.api["hanging-orders"]({ id: record.id })["iiko-close"].post(),
        onSuccess: (r) => report(r as any, t("iikoActions.closed")),
        onError: (e: Error) => toast.error(e.message),
    });

    const options = useQuery({
        queryKey: ["hanging-orders-iiko-options", record.brand],
        enabled: cancelOpen,
        staleTime: 10 * 60 * 1000,
        queryFn: async () => {
            const { data, error } = await apiClient.api["hanging-orders"]["iiko-actions"].options.get({
                query: { brand: record.brand as "chopar" | "les_ailes" },
            });
            if (error) throw new Error((error.value as any)?.message ?? t("iikoOptionsError"));
            return (data as { data: { cancelCauses: Option[]; removalTypes: Option[] } }).data;
        },
    });

    const cancel = useMutation({
        mutationFn: () =>
            apiClient.api["hanging-orders"]({ id: record.id })["iiko-cancel"].post({
                cancelCauseId: causeId,
                removalTypeId: removalId,
                ...(comment.trim() && { comment: comment.trim() }),
            }),
        onSuccess: (r) => {
            report(r as any, t("iikoActions.cancelled"));
            setCancelOpen(false);
            setCauseId("");
            setRemovalId("");
            setComment("");
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const busy = close.isPending || cancel.isPending;

    return (
        <div className="flex items-center">
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" title={t("iikoActions.closeTitle")} disabled={busy} className="h-7 w-7 p-0">
                        {close.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        )}
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("iikoActions.closeConfirmTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("iikoActions.closeDescription", { order: describe(t, record) })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("iikoActions.keepOpen")}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => close.mutate()}>{t("iikoActions.close")}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" title={t("iikoActions.cancelTitle")} disabled={busy} className="h-7 w-7 p-0">
                        {cancel.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <XCircle className="h-4 w-4 text-red-600" />
                        )}
                    </Button>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("iikoActions.cancelTitle")}</DialogTitle>
                        <DialogDescription>
                            {t("iikoActions.cancelDescription", { order: describe(t, record) })}
                        </DialogDescription>
                    </DialogHeader>

                    {options.isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> {t("iikoOptionsLoading")}
                        </div>
                    ) : options.error ? (
                        <p className="text-sm text-red-600">{(options.error as Error).message}</p>
                    ) : (
                        <div className="grid gap-4">
                            <div className="grid gap-2">
                                <Label>{t("cancelCause")}</Label>
                                <Select value={causeId} onValueChange={setCauseId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={t("cancelCausePlaceholder")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {options.data?.cancelCauses.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>
                                                {c.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>{t("removalType")}</Label>
                                <Select value={removalId} onValueChange={setRemovalId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={t("removalTypePlaceholder")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {options.data?.removalTypes.map((t) => (
                                            <SelectItem key={t.id} value={t.id}>
                                                {t.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>{t("iikoActions.comment")}</Label>
                                <Textarea
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    maxLength={500}
                                    placeholder={t("iikoActions.commentPlaceholder")}
                                />
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={cancel.isPending}>
                            {t("keepOrder")}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={!causeId || !removalId || cancel.isPending}
                            onClick={() => cancel.mutate()}
                        >
                            {cancel.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {t("iikoActions.cancelOrder")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
