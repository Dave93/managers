"use client"

import { Metadata } from "next";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus, Download, Search, Filter } from "lucide-react";
import Link from "next/link";
import { DataTable } from "./data-table";
import { hangingOrdersColumns } from "./columns";
import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import CanAccess from "@admin/components/can-access";
import { toast } from "sonner";
import { useState, useCallback } from "react";
import dayjs from "dayjs";
import { saveAs } from 'file-saver';
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@admin/components/ui/card";
import { DateRangeFilter } from "@admin/components/filters/date-range-filter/date-range-filter";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { cn } from "@admin/lib/utils";

export default function HangingOrdersPage() {
    const [searchTerm, setSearchTerm] = useState("");
    const [brandFilter, setBrandFilter] = useState<string>("all");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const { dateRange } = useDateRangeState();

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
                order.date || "",
                order.orderId || "",
                order.conception || "",
                order.timestamp ? dayjs(order.timestamp).format('HH:mm:ss') : "",
                order.orderType || "",
                order.paymentType || "",
                order.receiptNumber || "",
                order.orderStatus || "",
                order.comments || "",
                order.problem || "",
                order.phoneNumber || "",
                order.amount ? `${Number(order.amount).toLocaleString('ru-RU', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2
                }).replace(/,/g, ' ')} сум` : "",
                order.composition || "",
                order.status || "",
                order.comment || ""
            ]);
            
            const escapeCSV = (value: any) => {
                const str = String(value);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };
            
            const csvContent = BOM + [
                headers.map(escapeCSV).join(';'),
                ...rows.map(row => row.map(escapeCSV).join(';'))
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
                />
            </div>
        </div>
    );
}