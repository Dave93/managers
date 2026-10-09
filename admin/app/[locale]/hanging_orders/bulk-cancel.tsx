"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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

const summary = (s: Stats) =>
    [
        `отменено ${s.cancelled}`,
        s.alreadyClosed && `уже закрыты в iikoServer ${s.alreadyClosed} (не тронуты)`,
        s.pending && `касса не подтвердила ${s.pending}`,
        s.notInCloud && `нет в iikoCloud — старше ~120 дней ${s.notInCloud}`,
        s.errors && `ошибок ${s.errors}`,
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
}: {
    target: BulkTarget | null;
    onClose: () => void;
    onDone: () => void;
}) {
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
                if (error) throw new Error((error.value as any)?.message ?? "Не удалось получить справочники iiko");
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
            if (error) throw new Error((error.value as any)?.message ?? "Не удалось запустить отмену");
            const jobId = (data as { job: { id: string } }).job.id;
            onClose();

            const toastId = toast.loading("Массовая отмена запущена…");
            try {
                const startedAt = Date.now();
                while (Date.now() - startedAt < 3 * 60 * 60 * 1000) {
                    await new Promise((r) => setTimeout(r, 3000));
                    const { data: st, error: stErr } = await apiClient.api["hanging-orders"]["iiko-cancel-bulk"]({
                        jobId,
                    }).get();
                    if (stErr) throw new Error((stErr.value as any)?.message ?? "Статус отмены недоступен");
                    const status = st as { state: string; progress: string; stats: Stats };
                    if (status.state === "running") {
                        toast.loading(`Отмена: ${status.progress}`, { id: toastId });
                        continue;
                    }
                    return status;
                }
                throw new Error("Отмена идёт дольше 3 часов — проверьте журнал позже");
            } finally {
                toast.dismiss(toastId);
            }
        },
        onSuccess: (status) => {
            const s = status.stats;
            const text = summary(s);
            if (status.state === "stopped") {
                toast.error(
                    `Остановлено после ${s.errors} ошибок кассы подряд: ${text}. ${s.errorSamples[0] ?? ""}`,
                    { duration: 30000 },
                );
            } else if (status.state === "error") {
                toast.error(`Отмена упала: ${s.errorSamples[0] ?? ""}`, { duration: 30000 });
            } else if (s.errors > 0) {
                toast.warning(`${text}. Пример ошибки: ${s.errorSamples[0] ?? ""}`, { duration: 30000 });
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
                        Отменить {target?.count ?? 0}{" "}
                        {target?.mode === "ids" ? "выбранных заказов" : "заказов по фильтру"} в iiko
                    </DialogTitle>
                    <DialogDescription>
                        Только висящие и не старше 115 дней — старше iikoCloud их уже не хранит. Закрытые в iikoServer пропускаются — это
                        оплаченные заказы. Если касса откажет 5 раз подряд — отмена остановится сама.
                    </DialogDescription>
                </DialogHeader>

                {options.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Загружаю справочники iiko…
                    </div>
                ) : options.error ? (
                    <p className="text-sm text-red-600">{(options.error as Error).message}</p>
                ) : (
                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <Label>Причина отмены</Label>
                            <Select value={cause} onValueChange={setCause}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Выберите причину" />
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
                            <Label>Тип удаления</Label>
                            <Select value={removal} onValueChange={setRemoval}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Со списанием или без" />
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
                            <Label>Комментарий, если у заказа нет заметки</Label>
                            <Textarea
                                value={fallback}
                                onChange={(e) => setFallback(e.target.value)}
                                maxLength={500}
                                placeholder="У каждого заказа в iiko уйдёт его «Заметка». Этот текст — только для заказов без неё."
                            />
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={run.isPending}>
                        Не отменять
                    </Button>
                    <Button variant="destructive" disabled={!ready || run.isPending} onClick={() => run.mutate()}>
                        {run.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Отменить {target?.count ?? 0}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
