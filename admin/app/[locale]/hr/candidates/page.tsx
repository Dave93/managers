"use client"

import { Metadata } from "next";
import { Button } from "@admin/components/ui/buttonOrigin";
import { CalendarIcon, Plus, Download, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DataTable } from "./data-table";
import { candidateColumns } from "./columns";
import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";
import CanAccess from "@admin/components/can-access";
import { CandidateSheet } from "@admin/components/forms/candidate/sheet";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { cn } from "@admin/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover";
import { SelectContent, SelectValue, SelectItem, SelectTrigger, Select } from "@admin/components/ui/select";
import { Calendar } from "@admin/components/ui/calendar";
import type { DropdownNavProps, DropdownProps } from "react-day-picker"
import { parseZonedDateTime } from "@internationalized/date";
import { useState, useCallback, useEffect } from "react";
import dayjs from "dayjs";
import { saveAs } from 'file-saver';
import { Badge } from "@admin/components/ui/badge";

// export const metadata: Metadata = {
//     title: "Candidates",
//     description: "Manage candidates",
// };

export default function CandidatesListPage() {
    const searchParams = useSearchParams();
    const vacancyId = searchParams.get('vacancyId') || '';
    const [vacancyInfo, setVacancyInfo] = useState<{
        applicationNum?: string;
        position?: string;
    } | null>(null);

    // Fetch vacancy information when vacancyId is provided
    useEffect(() => {
        const getVacancyInfo = async () => {
            if (!vacancyId) {
                setVacancyInfo(null);
                return;
            }

            try {
                const { data } = await apiClient.api.vacancy.get({
                    query: {
                        limit: "1",
                        offset: "0",
                        filters: JSON.stringify([
                            { field: "id", operator: "eq", value: vacancyId }
                        ])
                    }
                });

                if (data?.data?.[0]) {
                    setVacancyInfo({
                        applicationNum: data.data[0].applicationNum as string,
                        position: data.data[0].positionTitle as string,
                    });
                }
            } catch (error) {
                console.error("Error fetching vacancy info:", error);
            }
        };

        getVacancyInfo();
    }, [vacancyId]);

    const handleSubmit = async () => {
        toast.success("Список кандидатов обновлен");
    };

    const [date, setDate] = useState(new Date("2024-04-04T00:00[UTC]"));

    const handleCalendarChange = (_value: string | number, _e: React.ChangeEventHandler<HTMLSelectElement>) => {
        const _event = {
            target: {
                value: String(_value),
            },
        } as React.ChangeEvent<HTMLSelectElement>
        _e(_event)
    }
    
    const { data: candidatesData, refetch } = useQuery({
        queryKey: ["candidates-export"],
        queryFn: async () => {
            const { data } = await apiClient.api.candidates.get({
                query: {
                    limit: "1000", // Получаем больше записей для экспорта
                },
            });
            return data;
        },
        enabled: false, // Не выполняем запрос автоматически
    });
    
    const exportToCSV = useCallback(async () => {
        // Сначала получаем данные
        toast.loading("Загрузка данных...");
        const { data: freshData } = await refetch();
        toast.dismiss();
        
        if (!freshData?.data || freshData.data.length === 0) {
            toast.error("Нет данных для экспорта");
            return;
        }
        
        try {
            // Создаем заголовки с BOM для правильной кодировки в Excel
            const BOM = "\uFEFF";
            const headers = ["ФИО", "Номер телефона", "Откуда узнали", "Вакансия"];
            
            // Создаем строки данных
            const rows = freshData.data.map((candidate: any) => [
                candidate.fullName || "",
                candidate.phoneNumber || "",
                candidate.source || "",
                candidate.vacancyId || ""
            ]);
            
            // Функция для экранирования значений CSV
            const escapeCSV = (value: any) => {
                const str = String(value);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };
            
            // Формируем CSV контент с BOM для Excel
            const csvContent = BOM + [
                headers.map(escapeCSV).join(';'),  // Используем точку с запятой для Excel
                ...rows.map(row => row.map(escapeCSV).join(';'))
            ].join('\r\n');  // Используем CRLF для Windows
            
            // Создаем и скачиваем файл
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            saveAs(blob, `candidates-${dayjs().format('YYYY-MM-DD')}.csv`);
            
            toast.success("Экспорт выполнен успешно");
        } catch (error) {
            console.error("Error exporting to CSV:", error);
            toast.error("Ошибка при экспорте");
        }
    }, [refetch]);
    
    return (
        <div>
            <div className="flex justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">
                        Анкета
                    </h1>
                    {vacancyInfo && (
                        <div className="mt-2 flex items-center gap-2">
                            <Link 
                                href="/hr/vacancy"
                                className="text-sm text-muted-foreground flex items-center hover:text-primary"
                            >
                                <ArrowLeft className="h-4 w-4 mr-1" />
                                Вернуться к вакансиям
                            </Link>
                            <span className="text-sm text-muted-foreground">|</span>
                            <Badge variant="outline" className="text-sm">
                                Вакансия: {vacancyInfo.applicationNum} - {vacancyInfo.position}
                            </Badge>
                        </div>
                    )}
                </div>
                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={exportToCSV}
                        className="mr-2"
                    >
                        <Download className="h-4 w-4 mr-2" />
                        Экспорт в Excel
                    </Button>
                    <CanAccess permission="candidates.add">
                        <CandidateSheet />
                        {/* <CandidateSheet2 onSubmit={handleSubmit} vacancyId={vacancyId} /> */}
                    </CanAccess>
                </div>
            </div>
            <div className="py-10">
                <DataTable columns={candidateColumns} vacancyId={vacancyId} />
            </div>
        </div>
    );
}