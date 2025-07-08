"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon, Eye, Calendar } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import { hangingOrders } from "@backend/../drizzle/schema";
import { Badge } from "@admin/components/ui/badge";
import dayjs from "dayjs";
import { StatusUpdateSheet } from "./status-update-sheet";
import { CommentEditor } from "./comment-editor";
import { StatusDropdown } from "./status-dropdown";

const ordersStatusText = {
    "Unconfirmed": "Не подтвержден",
    "WaitCooking": "Ожидает приготовления",
    "ReadyForCooking": "Готов к приготовлению",
    "CookingStarted": "Приготовление начато",
    "CookingCompleted": "Приготовление завершено",
    "Waiting": "Ожидает доставки",
    "OnWay": "В пути",
}

const getBrandBadgeVariant = (brand: string) => {
    switch (brand) {
        case "chopar":
            return "default";
        case "les_ailes":
            return "secondary";
        default:
            return "outline";
    }
};

const getStatusBadgeVariant = (status: string) => {
    switch (status) {
        case "pending":
            return "secondary";
        case "in_progress":
            return "default";
        case "resolved":
            return "default";
        case "cancelled":
            return "destructive";
        default:
            return "outline";
    }
};

const getStatusText = (status: string) => {
    switch (status) {
        case "pending":
            return "В ожидании";
        case "in_progress":
            return "В работе";
        case "resolved":
            return "Решено";
        case "cancelled":
            return "Отменено";
        default:
            return status || "Не указан";
    }
};

export const hangingOrdersColumns: ColumnDef<typeof hangingOrders.$inferSelect>[] = [
    {
        accessorKey: "brand",
        header: "Бренд",
        meta: {
            sticky: "left",
        },
        cell: ({ row }) => {
            const brand = row.getValue("brand") as string;
            return (
                <Badge variant={getBrandBadgeVariant(brand)}>
                    {brand === "chopar" ? "Chopar" : brand === "les_ailes" ? "Les Ailes" : brand}
                </Badge>
            );
        },
    },
    {
        accessorKey: "date",
        header: "Дата",
        cell: ({ row }) => {
            const date = row.getValue("date") as string;
            return date ? dayjs(date).format('DD.MM.YYYY') : "";
        },
    },
    {
        accessorKey: "timestamp",
        header: "Время",
        cell: ({ row }) => {
            const timestamp = row.getValue("timestamp") as string;
            return timestamp ? (
                <div className="flex items-center">
                    <Calendar className="mr-1 h-3 w-3" />
                    {dayjs(timestamp).format('HH:mm:ss')}
                </div>
            ) : "";
        },
    },
    {
        accessorKey: "orderId",
        header: "ID заказа",
        cell: ({ row }) => {
            const orderId = row.getValue("orderId") as string;
            return (
                <div className="font-mono text-sm">
                    {orderId}
                </div>
            );
        },
    },
    {
        accessorKey: "conception",
        header: "Концепция",
        meta: {
            sticky: "left",
        },
    },
    {
        accessorKey: "orderType",
        header: "Тип заказа",
    },
    {
        accessorKey: "paymentType",
        header: "Тип оплаты",
    },
    {
        accessorKey: "orderStatus",
        header: "Статус заказа",
        cell: ({ row }) => {
            const orderStatus = row.getValue("orderStatus") as string;
            return ordersStatusText[orderStatus as keyof typeof ordersStatusText] || orderStatus;
        },
    },
    {
        accessorKey: "amount",
        header: "Сумма",
        cell: ({ row }) => {
            const amount = row.getValue("amount") as string;
            if (!amount) return "";
            
            // Форматируем число с разделением тысячных пробелами
            const formattedAmount = Number(amount).toLocaleString('ru-RU', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            }).replace(/,/g, ' ');
            
            return `${formattedAmount} сум`;
        },
    },
    {
        accessorKey: "phoneNumber",
        header: "Телефон",
    },
    {
        accessorKey: "problem",
        header: "Проблема",
        cell: ({ row }) => {
            const problem = row.getValue("problem") as string;
            return problem ? (
                <div className="max-w-[200px] truncate" title={problem}>
                    {problem}
                </div>
            ) : "";
        },
    },
    {
        accessorKey: "status",
        header: "Статус обработки",
        cell: ({ row }) => {
            const record = row.original;
            return (
                <StatusDropdown
                    recordId={record.id}
                    currentStatus={record.status}
                    size="sm"
                />
            );
        },
    },
    {
        accessorKey: "comment",
        header: "Комментарий",
        cell: ({ row }) => {
            const record = row.original;
            return (
                <div className="min-w-[200px] max-w-[300px]">
                    <CommentEditor
                        recordId={record.id}
                        initialComment={record.comment}
                    />
                </div>
            );
        },
    },
    {
        id: "actions",
        header: "Действия",
        cell: ({ row }) => {
            const record = row.original;

            return (
                <div className="flex items-center space-x-2">
                    <StatusUpdateSheet
                        recordId={record.id}
                        currentStatus={record.status}
                        currentComment={record.comment}
                        trigger={
                            <Button variant="ghost" size="sm" title="Подробнее">
                                <Eye className="h-4 w-4" />
                            </Button>
                        }
                    />
                </div>
            );
        },
    },
];