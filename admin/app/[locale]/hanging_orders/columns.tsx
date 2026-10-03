"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon, Eye } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import { hangingOrders } from "@backend/../drizzle/schema";
import { Badge } from "@admin/components/ui/badge";
import dayjs from "dayjs";
import { StatusUpdateSheet } from "./status-update-sheet";
import { CommentEditor } from "./comment-editor";
import { StatusDropdown } from "./status-dropdown";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@admin/components/ui/hover-card";

const ordersStatusText = {
    "Unconfirmed": "Не подтвержден",
    "WaitCooking": "Ожидает приготовления",
    "ReadyForCooking": "Готов к приготовлению",
    "CookingStarted": "Приготовление начато",
    "CookingCompleted": "Приготовление завершено",
    "Waiting": "Ожидает доставки",
    "OnWay": "В пути",
    "Delivered": "Доставлен",
    "Closed": "Закрыт",
    "Cancelled": "Отменён",
}

// Закрыт/Отменён — заказ больше не висит; после ре-синка из iiko такие строки
// гасим визуально, но не удаляем: в status/comment лежит ручная работа менеджеров.
const FINAL_ORDER_STATUSES = ["Closed", "Cancelled"];

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
            const { date, timestamp } = row.original;
            if (!date) return "";
            const time = timestamp ? dayjs(timestamp).format('HH:mm') : "";
            return (
                <span className="tabular-nums" title={timestamp ? dayjs(timestamp).format('DD.MM.YYYY HH:mm:ss') : undefined}>
                    {dayjs(date).format('DD.MM.YY')}{time && ` ${time}`}
                </span>
            );
        },
    },
    {
        accessorKey: "orderId",
        header: "ID",
        cell: ({ row }) => {
            const orderId = row.getValue("orderId") as string;
            if (!orderId) return "";
            return (
                <HoverCard>
                    <HoverCardTrigger asChild>
                        <span className="font-mono text-xs cursor-pointer hover:underline">
                            …{orderId.slice(-8)}
                        </span>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-auto">
                        <p className="font-mono text-xs select-all">{orderId}</p>
                    </HoverCardContent>
                </HoverCard>
            );
        },
    },
    {
        accessorKey: "conception",
        header: "Концепция",
        meta: {
            sticky: "left",
        },
        cell: ({ row }) => {
            const conception = row.getValue("conception") as string;
            if (!conception) return "";
            return (
                <div className="max-w-[150px] truncate" title={conception}>
                    {conception}
                </div>
            );
        },
    },
    {
        accessorKey: "orderType",
        header: () => <span title="Тип заказа">Тип</span>,
        cell: ({ row }) => {
            const orderType = row.getValue("orderType") as string;
            if (!orderType) return "";
            // "Доставка курьером" распирала колонку шире всех остальных значений.
            const short = orderType.replace(/^Доставка курьером$/, "Курьер");
            return <span title={orderType}>{short}</span>;
        },
    },
    {
        accessorKey: "paymentType",
        header: () => <span title="Тип оплаты">Оплата</span>,
    },
    {
        accessorKey: "orderStatus",
        header: () => <span title="Статус заказа">Статус</span>,
        cell: ({ row }) => {
            const orderStatus = row.getValue("orderStatus") as string;
            const label = ordersStatusText[orderStatus as keyof typeof ordersStatusText] || orderStatus;
            return FINAL_ORDER_STATUSES.includes(orderStatus) ? (
                <span className="text-muted-foreground">{label}</span>
            ) : (
                label
            );
        },
    },
    {
        accessorKey: "comments",
        header: () => <span title="Комментарии филиала">Коммент.</span>,
        cell: ({ row }) => {
            const comment = row.getValue("comments") as string;
            if (!comment) return "";
            
            return (
                <HoverCard>
                    <HoverCardTrigger asChild>
                        <div className="max-w-[120px] truncate cursor-pointer hover:underline">
                            {comment}
                        </div>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-80">
                        <div className="text-sm">
                            <p className="font-semibold mb-2">Полный комментарий:</p>
                            <p className="whitespace-pre-wrap break-words">{comment}</p>
                        </div>
                    </HoverCardContent>
                </HoverCard>
            );
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
        accessorKey: "receiptNumber",
        header: () => <span title="Номер чека">Чек</span>,
    },
    {
        accessorKey: "problem",
        header: "Проблема",
        cell: ({ row }) => {
            const problem = row.getValue("problem") as string;
            if (!problem) return "";
            
            return (
                <HoverCard>
                    <HoverCardTrigger asChild>
                        <div className="max-w-[120px] truncate cursor-pointer hover:underline">
                            {problem}
                        </div>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-80">
                        <div className="text-sm">
                            <p className="font-semibold mb-2">Полная проблема:</p>
                            <p className="whitespace-pre-wrap break-words">{problem}</p>
                        </div>
                    </HoverCardContent>
                </HoverCard>
            );
        },
    },
    {
        accessorKey: "status",
        header: () => <span title="Статус обработки">Обработка</span>,
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
        header: () => <span title="Комментарий менеджера">Заметка</span>,
        cell: ({ row }) => {
            const record = row.original;
            return (
                <div className="max-w-[140px]">
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
        header: () => <span className="sr-only">Действия</span>,
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