"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
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

type Option = { id: string; name: string };
type Options = { cancelCauses: Option[]; removalTypes: Option[] };

type Stats = {
    total: number;
    done: number;
    cancelled: number;
    alreadyClosed: number;
    errors: number;
    pending: number;
    notInCloud: number;
    cloudClosed: number;
    tooOld: number;
    stopped: boolean;
    errorSamples: string[];
};

export type BulkTarget =
    | { mode: "ids"; ids: string[]; count: number }
    | { mode: "filter"; filters: string | undefined; count: number };

const BRANDS = ["les_ailes", "chopar"] as const;

/** Названия, которые есть у обоих брендов: у каждой организации iiko свои id. */
const common = (lists: Option[][]) => {
    const [first, ...rest] = lists;
    return (first ?? [])
        .map((o) => o.name)
        .filter((name) => rest.every((l) => l.some((o) => o.name === name)));
};

const summary = (t: (key: string, values?: Record<string, string | number>) => string, s: Stats) =>
    [
        t("bulk.summary.cancelled", { count: s.cancelled }),
        s.alreadyClosed && t("bulk.summary.alreadyClosed", { count: s.alreadyClosed }),
        s.pending && t("bulk.summary.pending", { count: s.pending }),
        s.notInCloud && t("bulk.summary.notInCloud", { count: s.notInCloud }),
        s.cloudClosed && t("bulk.summary.cloudClosed", { count: s.cloudClosed }),
        s.tooOld && t("bulk.summary.tooOld", { count: s.tooOld }),
        s.errors && t("bulk.summary.errors", { count: s.errors }),
    ]
        .filter(Boolean)
        .join(", ");

/**
 * Массовая отмена в iiko. Комментарий отмены каждого заказа — его «Заметка»;
 * если она пустая — общий комментарий из этого диалога.
 */
export function BulkCancelDialog({
    target,
    onClose,
    onDone,
    onProgress,
}: {
    target: BulkTarget | null;
    onClose: () => void;
    onDone: () => void;
    /** Ход прогона — для заметной панели на странице; null — прогон закончен. */
    onProgress?: (progress: { title: string; text: string } | null) => void;
}) {
    const t = useTranslations("hangingOrders");
    const [cause, setCause] = useState("");
    const [removal, setRemoval] = useState("");
    const [fallback, setFallback] = useState("");

    const options = useQuery({
        queryKey: ["hanging-orders-iiko-options-both"],
        enabled: !!target,
        staleTime: 10 * 60 * 1000,
        queryFn: async () => {
            const all: Options[] = [];
            for (const brand of BRANDS) {
                const { data, error } = await apiClient.api["hanging-orders"]["iiko-actions"].options.get({
                    query: { brand },
                });
                if (error) throw new Error((error.value as any)?.message ?? t("iikoOptionsError"));
                all.push((data as { data: Options }).data);
            }
            return {
                causes: common(all.map((o) => o.cancelCauses)),
                removals: common(all.map((o) => o.removalTypes)),
            };
        },
    });

    const run = useMutation({
        mutationFn: async () => {
            const { data, error } = await apiClient.api["hanging-orders"]["iiko-cancel-bulk"].post({
                ...(target?.mode === "ids" ? { ids: target.ids } : { filters: target?.filters }),
                cancelCauseName: cause,
                removalTypeName: removal,
                ...(fallback.trim() && { fallbackComment: fallback.trim() }),
            });
            if (error) throw new Error((error.value as any)?.message ?? t("bulk.startError"));
            const jobId = (data as { job: { id: string } }).job.id;
            onClose();

            const title = t("bulk.progressTitle");
            onProgress?.({ title, text: t("bulk.started") });
            try {
                const startedAt = Date.now();
                while (Date.now() - startedAt < 3 * 60 * 60 * 1000) {
                    await new Promise((r) => setTimeout(r, 3000));
                    const { data: st, error: stErr } = await apiClient.api["hanging-orders"]["iiko-cancel-bulk"]({
                        jobId,
                    }).get();
                    if (stErr) throw new Error((stErr.value as any)?.message ?? t("bulk.statusUnavailable"));
                    const status = st as { state: string; progress: string; stats: Stats };
                    if (status.state === "running") {
                        onProgress?.({ title, text: status.progress });
                        continue;
                    }
                    return status;
                }
                throw new Error(t("bulk.tooLong"));
            } finally {
                onProgress?.(null);
            }
        },
        onSuccess: (status) => {
            const s = status.stats;
            const text = summary(t, s);
            if (status.state === "stopped") {
                toast.error(
                    t("bulk.stopped", { errors: s.errors, text, sample: s.errorSamples[0] ?? "" }),
                    { duration: 30000 },
                );
            } else if (status.state === "error") {
                toast.error(t("bulk.failed", { sample: s.errorSamples[0] ?? "" }), { duration: 30000 });
            } else if (s.errors > 0) {
                toast.warning(t("bulk.withErrors", { text, sample: s.errorSamples[0] ?? "" }), { duration: 30000 });
            } else {
                toast.success(text, { duration: 15000 });
            }
            onDone();
        },
        onError: (e: Error) => toast.error(e.message),
    });

    const ready = useMemo(() => !!cause && !!removal, [cause, removal]);

    return (
        <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {t(target?.mode === "ids" ? "bulk.titleIds" : "bulk.titleFilter", { count: target?.count ?? 0 })}
                    </DialogTitle>
                    <DialogDescription>
                        {t("bulk.description")}
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
                            <Select value={cause} onValueChange={setCause}>
                                <SelectTrigger>
                                    <SelectValue placeholder={t("cancelCausePlaceholder")} />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.data?.causes.map((name) => (
                                        <SelectItem key={name} value={name}>
                                            {name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>{t("removalType")}</Label>
                            <Select value={removal} onValueChange={setRemoval}>
                                <SelectTrigger>
                                    <SelectValue placeholder={t("removalTypePlaceholder")} />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.data?.removals.map((name) => (
                                        <SelectItem key={name} value={name}>
                                            {name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>{t("bulk.fallbackLabel")}</Label>
                            <Textarea
                                value={fallback}
                                onChange={(e) => setFallback(e.target.value)}
                                maxLength={500}
                                placeholder={t("bulk.fallbackPlaceholder")}
                            />
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={run.isPending}>
                        {t("keepOrder")}
                    </Button>
                    <Button variant="destructive" disabled={!ready || run.isPending} onClick={() => run.mutate()}>
                        {run.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t("bulk.confirm", { count: target?.count ?? 0 })}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
