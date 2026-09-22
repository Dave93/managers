"use client"

import { Metadata } from "next";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus, Download, Search, Filter, RefreshCw } from "lucide-react";
import Link from "next/link";
import { DataTable } from "./data-table";
import { hangingOrdersColumns } from "./columns";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CanAccess from "@admin/components/can-access";
import { toast } from "sonner";
import { useState, useCallback, Suspense } from "react";
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

function HangingOrdersContent() {
    const [searchTerm, setSearchTerm] = useState("");
    const [brandFilter, setBrandFilter] = useState<string>("all");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    // По умолчанию прячем закрытые: страница про висящие заказы, а закрытые
    // после ре-синка перестают быть таковыми.
    const [hideClosed, setHideClosed] = useState(true);
    const { dateRange } = useDateRangeState();
    const queryClient = useQueryClient();

    // Ночной бот пишет снимок один раз и существующие строки не обновляет, так
    // что заказ, закрытый филиалом после снимка, висит здесь со старым статусом.
    // Кнопка перечитывает iiko по открытым строкам за последние 3 дня.
    const refreshFromIiko = useMutation({
        mutationFn: async () => {
            const { data, error } = await apiClient.api["hanging-orders"].refresh.post({
                ...(brandFilter !== "all" && { brand: brandFilter as "chopar" | "les_ailes" }),
                days: 3,
            });
            if (error) throw new Error((error.value as any)?.message ?? "Не удалось обновить статусы");
            return data;
        },
        onSuccess: (result) => {
            const reports: RefreshReport[] = (result?.data as RefreshReport[]) ?? [];
            const updated = reports.reduce((sum, r) => sum + r.updated, 0);
            const checked = reports.reduce((sum, r) => sum + r.checked, 0);
            const errors = reports.flatMap((r) => r.errors);

            queryClient.invalidateQueries({ queryKey: ["hanging-orders"] });

            if (errors.length > 0) {
                toast.warning(`Обновлено ${updated} из ${checked}. Ошибки: ${errors.join("; ")}`);
            } else {
                toast.success(`Проверено ${checked} заказов, обновлено ${updated}`);
            }
        },
        onError: (e: Error) => toast.error(e.message),
    });

    // Query for export
    const { data: exportData, refetch } = useQuery({
        queryKey: ["hanging-orders-export"],
        queryFn: async () => {
            const filters = [];
            
            if (brandFilter !== "all") {
                filters.push({ field: "brand", operator: "eq", value: brandFilter });
            }
            if (statusFilter !== "all") {
                filters.push({ field: "status", operator: "eq", value: statusFilter });
            }
            if (hideClosed) {
                filters.push({ field: "orderStatus", operator: "notIn", value: ["Closed", "Cancelled"] });
            }
            if (searchTerm) {
                filters.push({ field: "orderId", operator: "contains", value: searchTerm });
            }
            if (dateRange?.from) {
                filters.push({ field: "date", operator: "gte", value: dayjs(dateRange.from).format('YYYY-MM-DD') });
            }
            if (dateRange?.to) {
                filters.push({ field: "date", operator: "lte", value: dayjs(dateRange.to).format('YYYY-MM-DD') });
            }

            const { data } = await apiClient.api["hanging-orders"].get({
                query: {
                    limit: "10000",
                    offset: "0",
                    ...(filters.length > 0 && { filters: JSON.stringify(filters) }),
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
                order.orderStatus || "",
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
        // hideClosed намеренно не сбрасываем: если менеджер открыл закрытые,
        // чтобы найти конкретный заказ, сброс фильтров не должен их прятать.
        // DateRange очищается через его собственный хук через URL параметры
        // Можно добавить сброс dateRange если нужно
    };

    return (
        <div>
            <div className="flex justify-between items-start">
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
                            <DateRangeFilter />
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

            <div className="py-10">
                <DataTable 
                    columns={hangingOrdersColumns} 
                    searchTerm={searchTerm}
                    brandFilter={brandFilter}
                    statusFilter={statusFilter}
                    dateRange={dateRange || undefined}
                    hideClosed={hideClosed}
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