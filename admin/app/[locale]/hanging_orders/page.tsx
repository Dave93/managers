"use client"

import { Metadata } from "next";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus, Download, Search, Filter, RefreshCw, Info } from "lucide-react";
import Link from "next/link";
import { DataTable, type Facets } from "./data-table";
import { buildFiltersJson, officeStatusLabel, type ColumnFilters } from "./filters";
import { BulkCancelDialog, type BulkTarget } from "./bulk-cancel";
import { JobProgressBanner, type JobProgress } from "./job-progress";
import { useCanAccess } from "@admin/components/use-can-access";
import { useHangingOrdersColumns } from "./columns";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CanAccess from "@admin/components/can-access";
import { toast } from "sonner";
import { useState, useCallback, useEffect, Suspense } from "react";
import { useTranslations } from "next-intl";
import dayjs from "dayjs";
import { saveAs } from 'file-saver';
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Switch } from "@admin/components/ui/switch";
import { Label } from "@admin/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@admin/components/ui/card";
import { DateRangeFilter } from "@admin/components/filters/date-range-filter/date-range-filter";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { cn } from "@admin/lib/utils";

// Ответ POST /hanging-orders/refresh, по одному отчёту на бренд.
type RefreshReport = {
    brand: string;
    dates: string[];
    checked: number;
    updated: number;
    closed: number;
    errors: string[];
};

// По умолчанию — вчерашний день целиком; своё значение в URL (?date=) важнее.
const yesterdayRange = {
    from: dayjs().subtract(1, "day").startOf("day").toDate(),
    to: dayjs().subtract(1, "day").endOf("day").toDate(),
};

// Подписи статусов обработки для CSV-экспорта: выгрузка остаётся по-русски
// независимо от языка интерфейса.
const CSV_STATUS_LABELS: Record<string, string> = {
    "pending": "В ожидании",
    "in_progress": "В работе",
    "truth": "Правда",
    "lie": "Ложь",
    "no_info": "Нет информации"
};

function HangingOrdersContent() {
    const t = useTranslations("hangingOrders");
    const columns = useHangingOrdersColumns();
    const [searchTerm, setSearchTerm] = useState("");
    const [brandFilter, setBrandFilter] = useState<string>("all");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    // По умолчанию прячем закрытые: страница про висящие заказы, а закрытые
    // после ре-синка перестают быть таковыми.
    const [hideClosed, setHideClosed] = useState(true);
    const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
    const { dateRange } = useDateRangeState(yesterdayRange);

    // Массовая отмена — только admin (право hanging_orders.iiko_actions).
    const canIiko = useCanAccess("hanging_orders.iiko_actions");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [total, setTotal] = useState(0);
    const [bulkTarget, setBulkTarget] = useState<BulkTarget | null>(null);
    // Ход фоновой задачи — сверки или массовой отмены — для заметной панели.
    const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);

    // Те же фильтры, что у таблицы, — для «отменить всё по фильтру».
    const tableFilters = buildFiltersJson({
        brandFilter, statusFilter, searchTerm,
        dateRange: dateRange || undefined, hideClosed, columnFilters,
    });

    // Сменился фильтр — выбор с прежней выдачи больше не относится к экрану.
    useEffect(() => {
        setSelectedIds([]);
    }, [tableFilters]);

    // Справочник значений для выпадающих фильтров в шапке. Считается по тем же
    // верхним фильтрам, что и таблица, без колоночных — иначе выбор в одном
    // списке сужал бы варианты в нём же.
    const facetsFilters = buildFiltersJson({
        brandFilter, statusFilter, searchTerm,
        dateRange: dateRange || undefined, hideClosed,
    });
    const { data: facets } = useQuery({
        queryKey: ["hanging-orders-facets", facetsFilters],
        queryFn: async () => {
            const { data } = await apiClient.api["hanging-orders"].facets.get({
                query: { ...(facetsFilters && { filters: facetsFilters }) },
            });
            return (data as { data: Facets } | null)?.data;
        },
    });
    const queryClient = useQueryClient();

    // Ночной бот пишет снимок один раз и существующие строки не обновляет, так
    // что заказ, закрытый филиалом после снимка, висит здесь со старым статусом.
    // Кнопка перечитывает iiko по открытым строкам за период из фильтра
    // (без фильтра — за последние 3 дня). Сервер не пускает глубже 130 дней — iikoCloud хранит доставки ~120.
    const refreshFromIiko = useMutation({
        mutationFn: async () => {
            const { data, error } = await apiClient.api["hanging-orders"].refresh.post({
                ...(brandFilter !== "all" && { brand: brandFilter as "chopar" | "les_ailes" }),
                ...(dateRange?.from
                    ? {
                        dateFrom: dayjs(dateRange.from).format("YYYY-MM-DD"),
                        dateTo: dayjs(dateRange.to ?? dateRange.from).format("YYYY-MM-DD"),
                    }
                    : { days: 3 }),
            });
            if (error) throw new Error((error.value as any)?.message ?? t("refresh.error"));

            // Длинный период сервер сверяет фоновой задачей — опрашиваем её.
            const job = (data as { job?: { id: string; alreadyRunning?: boolean } } | null)?.job;
            if (!job) return data;

            const title = t("refresh.progressTitle");
            setJobProgress({
                title,
                text: job.alreadyRunning ? t("refresh.alreadyRunning") : t("refresh.started"),
            });
            try {
                const startedAt = Date.now();
                while (Date.now() - startedAt < 30 * 60 * 1000) {
                    await new Promise((r) => setTimeout(r, 3000));
                    const { data: st, error: stErr } = await apiClient.api["hanging-orders"]
                        .refresh({ jobId: job.id })
                        .get();
                    if (stErr) throw new Error((stErr.value as any)?.message ?? t("refresh.statusUnavailable"));
                    const status = st as { state: string; progress?: string; message?: string };
                    if (status.state === "done") return status;
                    if (status.state === "error") throw new Error(status.message ?? t("refresh.failed"));
                    setJobProgress({ title, text: status.progress ?? t("refresh.running") });
                }
                throw new Error(t("refresh.tooLong"));
            } finally {
                setJobProgress(null);
            }
        },
        onSuccess: (result) => {
            const reports: RefreshReport[] = (result?.data as RefreshReport[]) ?? [];
            const win = (result as { window?: { from: string; to: string } } | null)?.window;
            const period = win
                ? `${dayjs(win.from).format("DD.MM")}–${dayjs(win.to).format("DD.MM")}: `
                : "";
            const updated = reports.reduce((sum, r) => sum + r.updated, 0);
            const checked = reports.reduce((sum, r) => sum + r.checked, 0);
            const errors = reports.flatMap((r) => r.errors);

            queryClient.invalidateQueries({ queryKey: ["hanging-orders"] });

            if (errors.length > 0) {
                toast.warning(t("refresh.doneWithErrors", { period, updated, checked, errors: errors.join("; ") }));
            } else {
                toast.success(t("refresh.done", { period, checked, updated }));
            }
        },
        onError: (e: Error) => toast.error(e.message),
    });

    // Когда последний раз сверяли статусы с iiko (общее для всех, кто нажимает кнопку).
    // Утром про кнопку забывают: если сегодня сверки ещё не было — напоминаем.
    const canRefresh = useCanAccess("hanging_orders.edit");
    const { data: lastRefresh, isSuccess: lastRefreshLoaded } = useQuery({
        queryKey: ["hanging-orders", "refresh-status"],
        queryFn: async () => {
            const { data } = await apiClient.api["hanging-orders"]["refresh-status"].get();
            return (data as { data: { at: string; by: string | null } | null } | null)?.data ?? null;
        },
        refetchInterval: 5 * 60 * 1000,
    });
    const refreshStale =
        canRefresh && lastRefreshLoaded && (!lastRefresh || !dayjs(lastRefresh.at).isSame(dayjs(), "day"));
    const lastRefreshText = lastRefresh
        ? t("reminder.last", {
            when: dayjs(lastRefresh.at).format("DD.MM HH:mm"),
            who: lastRefresh.by ?? "—",
        })
        : t("reminder.never");

    // Query for export
    const { data: exportData, refetch } = useQuery({
        queryKey: ["hanging-orders-export"],
        queryFn: async () => {
            // Тот же сборщик, что у таблицы: выгрузка = то, что на экране.
            const filters = buildFiltersJson({
                brandFilter, statusFilter, searchTerm,
                dateRange: dateRange || undefined, hideClosed, columnFilters,
            });

            const { data } = await apiClient.api["hanging-orders"].get({
                query: {
                    limit: "10000",
                    offset: "0",
                    ...(filters && { filters }),
                },
            });
            return data;
        },
        enabled: false,
    });

    // Только для CSV — по-русски.
    const getStatusLabel = (status: string) => CSV_STATUS_LABELS[status] || status;

    const brandLabel = (brand?: string | null) =>
        brand === "les_ailes" ? "Les Ailes" : brand === "chopar" ? "Chopar" : brand || "";

    const exportToCSV = useCallback(async () => {
        toast.loading(t("export.loading"));
        const { data: freshData } = await refetch();
        toast.dismiss();

        if (!freshData?.data || freshData.data.length === 0) {
            toast.error(t("export.noData"));
            return;
        }

        try {
            const BOM = "\uFEFF";
            const headers = [
                "Бренд", "Дата", "ID заказа", "Концепция", "Время", "Тип заказа",
                "Тип оплаты", "Номер чека", "Статус заказа", "Комментарии",
                "Проблема", "Номер телефона", "Сумма", "Состав",
                "Статус обработки", "Комментарий обработки"
            ];

            const rows = freshData.data.map((order: any) => [
                brandLabel(order.brand),
                order.date ? dayjs(order.date).format('DD.MM.YYYY') : "",
                order.orderId || "",
                order.conception || "",
                order.timestamp ? dayjs(order.timestamp).format('HH:mm:ss') : "",
                order.orderType || "",
                order.paymentType || "",
                order.receiptNumber || "",
                officeStatusLabel(order.orderStatus),
                order.comments || "",
                order.problem || "",
                order.phoneNumber ? `'${order.phoneNumber}` : "",
                // Число без разделителей и «сум», чтобы Excel считал ячейку числом.
                // Десятичная запятая — для русской локали Excel.
                order.amount !== null && order.amount !== undefined && order.amount !== "" && Number.isFinite(Number(order.amount))
                    ? String(Math.round(Number(order.amount) * 100) / 100).replace('.', ',')
                    : "",
                order.composition || "",
                getStatusLabel(order.status || ""),
                order.comment || ""
            ]);
            
            const escapeCSV = (value: any) => {
                // Заменяем переносы строк на пробелы для компактного вида в Excel
                const str = String(value).replace(/\r?\n/g, ' ').trim();
                if (str.includes(',') || str.includes('"')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };
            
            const csvContent = BOM + [
                headers.map(escapeCSV).join(';'),
                ...rows.map((row: any) => row.map(escapeCSV).join(';'))
            ].join('\r\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            saveAs(blob, `Незакрытые заказы ${dayjs().format('YYYY-MM-DD')}.csv`);
            
            toast.success(t("export.success"));
        } catch (error) {
            console.error("Error exporting to CSV:", error);
            toast.error(t("export.error"));
        }
    }, [refetch, t]);

    const clearFilters = () => {
        setSearchTerm("");
        setBrandFilter("all");
        setStatusFilter("all");
        setColumnFilters({});
        // hideClosed намеренно не сбрасываем: если менеджер открыл закрытые,
        // чтобы найти конкретный заказ, сброс фильтров не должен их прятать.
        // DateRange очищается через его собственный хук через URL параметры
        // Можно добавить сброс dateRange если нужно
    };

    return (
        <div className="w-full min-w-0 overflow-x-hidden">
            <JobProgressBanner progress={jobProgress} />
            <div className="flex justify-between items-start gap-2">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">
                        {t("title")}
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        {t("subtitle")}
                    </p>
                    {canRefresh && lastRefreshLoaded && !refreshStale && (
                        <p className="text-muted-foreground mt-1 text-xs">{lastRefreshText}</p>
                    )}
                </div>
                <div className="flex items-center space-x-2">
                    <CanAccess permission="hanging_orders.edit">
                        <Button
                            variant="outline"
                            size="sm"
                            className={cn(refreshStale && "border-amber-400 ring-2 ring-amber-400/60")}
                            onClick={() => refreshFromIiko.mutate()}
                            disabled={refreshFromIiko.isPending}
                        >
                            <RefreshCw className={cn("h-4 w-4 mr-2", refreshFromIiko.isPending && "animate-spin")} />
                            {refreshFromIiko.isPending ? t("refresh.pending") : t("refresh.button")}
                        </Button>
                    </CanAccess>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={exportToCSV}
                    >
                        <Download className="h-4 w-4 mr-2" />
                        {t("export.button")}
                    </Button>
                </div>
            </div>

            {refreshStale && (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    <Info className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                        <div className="font-medium">{t("reminder.title")}</div>
                        <div>{t("reminder.body")} <span className="opacity-80">{lastRefreshText}</span></div>
                    </div>
                    <Button
                        size="sm"
                        onClick={() => refreshFromIiko.mutate()}
                        disabled={refreshFromIiko.isPending}
                    >
                        <RefreshCw className={cn("h-4 w-4 mr-2", refreshFromIiko.isPending && "animate-spin")} />
                        {refreshFromIiko.isPending ? t("refresh.pending") : t("reminder.action")}
                    </Button>
                </div>
            )}

            {/* Блок фильтров - компактный */}
            <Card className="mt-4">
                <CardContent className="py-4">
                    <div className="flex items-center gap-4 flex-wrap">
                        {/* Период */}
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium whitespace-nowrap">{t("filters.period")}</label>
                            <DateRangeFilter defaultRange={yesterdayRange} />
                        </div>

                        {/* Поиск по ID заказа */}
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium whitespace-nowrap">{t("filters.search")}</label>
                            <div className="relative">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder={t("filters.searchPlaceholder")}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-8 w-48"
                                />
                            </div>
                        </div>

                        {/* Бренд */}
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium whitespace-nowrap">{t("filters.brand")}</label>
                            <Select value={brandFilter} onValueChange={setBrandFilter}>
                                <SelectTrigger className="w-40">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t("filters.allBrands")}</SelectItem>
                                    <SelectItem value="chopar">Chopar</SelectItem>
                                    <SelectItem value="les_ailes">Les Ailes</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Статус обработки */}
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium whitespace-nowrap">{t("filters.status")}</label>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-44">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t("filters.allStatuses")}</SelectItem>
                                    <SelectItem value="pending">{t("processingStatus.pending")}</SelectItem>
                                    <SelectItem value="in_progress">{t("processingStatus.in_progress")}</SelectItem>
                                    <SelectItem value="truth">{t("processingStatus.truth")}</SelectItem>
                                    <SelectItem value="lie">{t("processingStatus.lie")}</SelectItem>
                                    <SelectItem value="no_info">{t("processingStatus.no_info")}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Скрыть закрытые */}
                        <div className="flex items-center gap-2">
                            <Switch
                                id="hide-closed"
                                checked={hideClosed}
                                onCheckedChange={setHideClosed}
                            />
                            <Label htmlFor="hide-closed" className="text-sm font-medium whitespace-nowrap">
                                {t("filters.hideClosed")}
                            </Label>
                        </div>

                        {/* Кнопка сброса */}
                        <Button variant="outline" size="sm" onClick={clearFilters} className="ml-auto">
                            {t("filters.reset")}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {canIiko && (
                // Для того, кто отменяет: iikoCloud гарантирует доступ к заказам
                // только за 7 дней — старше отмена может не пройти.
                <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                        {t.rich("sevenDaysNotice", { b: (chunks) => <b>{chunks}</b> })}
                    </span>
                </div>
            )}

            {canIiko && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border px-4 py-2 text-sm">
                    <span className="text-muted-foreground">
                        {t.rich("selected", {
                            count: selectedIds.length,
                            num: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                        })}
                    </span>
                    <Button
                        variant="destructive"
                        size="sm"
                        disabled={selectedIds.length === 0}
                        onClick={() => setBulkTarget({ mode: "ids", ids: selectedIds, count: selectedIds.length })}
                    >
                        {t("cancelSelected")}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={total === 0}
                        onClick={() => setBulkTarget({ mode: "filter", filters: tableFilters, count: total })}
                    >
                        {t("cancelAllByFilter", { total })}
                    </Button>
                    {selectedIds.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                            {t("clearSelection")}
                        </Button>
                    )}
                </div>
            )}

            <BulkCancelDialog
                target={bulkTarget}
                onProgress={setJobProgress}
                onClose={() => setBulkTarget(null)}
                onDone={() => {
                    setSelectedIds([]);
                    queryClient.invalidateQueries({ queryKey: ["hanging-orders"] });
                }}
            />

            <div className="py-10">
                <DataTable 
                    columns={columns} 
                    searchTerm={searchTerm}
                    brandFilter={brandFilter}
                    statusFilter={statusFilter}
                    dateRange={dateRange || undefined}
                    hideClosed={hideClosed}
                    columnFilters={columnFilters}
                    onColumnFiltersChange={setColumnFilters}
                    facets={facets}
                    selectable={canIiko}
                    selectedIds={selectedIds}
                    onSelectedIdsChange={setSelectedIds}
                    onTotalChange={setTotal}
                />
            </div>
        </div>
    );
}

function PageFallback() {
    const t = useTranslations("hangingOrders");
    return <div>{t("loading")}</div>;
}

export default function HangingOrdersPage() {
    return (
        <Suspense fallback={<PageFallback />}>
            <HangingOrdersContent />
        </Suspense>
    );
}