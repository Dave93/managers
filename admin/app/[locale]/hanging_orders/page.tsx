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
import { hangingOrdersColumns } from "./columns";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CanAccess from "@admin/components/can-access";
import { toast } from "sonner";
import { useState, useCallback, useEffect, Suspense } from "react";
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

function HangingOrdersContent() {
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
            if (error) throw new Error((error.value as any)?.message ?? "Не удалось обновить статусы");

            // Длинный период сервер сверяет фоновой задачей — опрашиваем её.
            const job = (data as { job?: { id: string; alreadyRunning?: boolean } } | null)?.job;
            if (!job) return data;

            const title = "Сверка с iiko";
            setJobProgress({
                title,
                text: job.alreadyRunning ? "уже идёт — подключаюсь к ней…" : "запущена…",
            });
            try {
                const startedAt = Date.now();
                while (Date.now() - startedAt < 30 * 60 * 1000) {
                    await new Promise((r) => setTimeout(r, 3000));
                    const { data: st, error: stErr } = await apiClient.api["hanging-orders"]
                        .refresh({ jobId: job.id })
                        .get();
                    if (stErr) throw new Error((stErr.value as any)?.message ?? "Статус сверки недоступен");
                    const status = st as { state: string; progress?: string; message?: string };
                    if (status.state === "done") return status;
                    if (status.state === "error") throw new Error(status.message ?? "Сверка упала");
                    setJobProgress({ title, text: status.progress ?? "идёт…" });
                }
                throw new Error("Сверка идёт дольше 30 минут — проверьте позже");
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
                toast.warning(`${period}обновлено ${updated} из ${checked}. Ошибки: ${errors.join("; ")}`);
            } else {
                toast.success(`${period}проверено ${checked} заказов, обновлено ${updated}`);
            }
        },
        onError: (e: Error) => toast.error(e.message),
    });

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

    const getStatusLabel = (status: string) => {
        const statusLabels: Record<string, string> = {
            "pending": "В ожидании",
            "in_progress": "В работе",
            "truth": "Правда",
            "lie": "Ложь",
            "no_info": "Нет информации"
        };
        return statusLabels[status] || status;
    };

    const exportToCSV = useCallback(async () => {
        toast.loading("Загрузка данных...");
        const { data: freshData } = await refetch();
        toast.dismiss();

        if (!freshData?.data || freshData.data.length === 0) {
            toast.error("Нет данных для экспорта");
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
                order.brand || "",
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
                order.amount ? `${Number(order.amount).toLocaleString('ru-RU', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2
                }).replace(/,/g, ' ')} сум` : "",
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
            saveAs(blob, `hanging-orders-${dayjs().format('YYYY-MM-DD')}.csv`);
            
            toast.success("Экспорт выполнен успешно");
        } catch (error) {
            console.error("Error exporting to CSV:", error);
            toast.error("Ошибка при экспорте");
        }
    }, [refetch]);

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
                        Висячие заказы
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Управление и отслеживание проблемных заказов
                    </p>
                </div>
                <div className="flex items-center space-x-2">
                    <CanAccess permission="hanging_orders.edit">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => refreshFromIiko.mutate()}
                            disabled={refreshFromIiko.isPending}
                        >
                            <RefreshCw className={cn("h-4 w-4 mr-2", refreshFromIiko.isPending && "animate-spin")} />
                            {refreshFromIiko.isPending ? "Обновляю…" : "Обновить из iiko"}
                        </Button>
                    </CanAccess>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={exportToCSV}
                    >
                        <Download className="h-4 w-4 mr-2" />
                        Экспорт в Excel
                    </Button>
                </div>
            </div>

            {/* Блок фильтров - компактный */}
            <Card className="mt-4">
                <CardContent className="py-4">
                    <div className="flex items-center gap-4 flex-wrap">
                        {/* Период */}
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium whitespace-nowrap">Период:</label>
                            <DateRangeFilter defaultRange={yesterdayRange} />
                        </div>

                        {/* Поиск по ID заказа */}
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium whitespace-nowrap">Поиск:</label>
                            <div className="relative">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="ID заказа..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-8 w-48"
                                />
                            </div>
                        </div>

                        {/* Бренд */}
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium whitespace-nowrap">Бренд:</label>
                            <Select value={brandFilter} onValueChange={setBrandFilter}>
                                <SelectTrigger className="w-40">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Все бренды</SelectItem>
                                    <SelectItem value="chopar">Chopar</SelectItem>
                                    <SelectItem value="les_ailes">Les Ailes</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Статус обработки */}
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium whitespace-nowrap">Статус:</label>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-44">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Все статусы</SelectItem>
                                    <SelectItem value="pending">В ожидании</SelectItem>
                                    <SelectItem value="in_progress">В работе</SelectItem>
                                    <SelectItem value="truth">Правда</SelectItem>
                                    <SelectItem value="lie">Ложь</SelectItem>
                                    <SelectItem value="no_info">Нет информации</SelectItem>
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
                                Скрыть закрытые
                            </Label>
                        </div>

                        {/* Кнопка сброса */}
                        <Button variant="outline" size="sm" onClick={clearFilters} className="ml-auto">
                            Сбросить
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
                        iiko гарантирует отмену только заказов <b>за последние 7 дней</b>. Старше — пока
                        iikoCloud их ещё хранит, а это не обещано и может кончиться в любой момент. Заказ,
                        который облако уже не хранит, отменяется только вручную на кассе. Отменяйте
                        висящие, пока им нет недели.
                    </span>
                </div>
            )}

            {canIiko && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border px-4 py-2 text-sm">
                    <span className="text-muted-foreground">
                        Выбрано: <span className="font-medium text-foreground">{selectedIds.length}</span>
                    </span>
                    <Button
                        variant="destructive"
                        size="sm"
                        disabled={selectedIds.length === 0}
                        onClick={() => setBulkTarget({ mode: "ids", ids: selectedIds, count: selectedIds.length })}
                    >
                        Отменить выбранные в iiko
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={total === 0}
                        onClick={() => setBulkTarget({ mode: "filter", filters: tableFilters, count: total })}
                    >
                        Отменить все по фильтру ({total})
                    </Button>
                    {selectedIds.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                            Снять выбор
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
                    columns={hangingOrdersColumns} 
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

export default function HangingOrdersPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <HangingOrdersContent />
        </Suspense>
    );
}