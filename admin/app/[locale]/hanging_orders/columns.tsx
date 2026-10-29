"use client";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ColumnDef } from "@tanstack/react-table";
import { Cloud, Edit2Icon, Eye } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import { hangingOrders } from "@backend/../drizzle/schema";
import { Badge } from "@admin/components/ui/badge";
import dayjs from "dayjs";
import { StatusUpdateSheet } from "./status-update-sheet";
import { CommentEditor } from "./comment-editor";
import { StatusDropdown } from "./status-dropdown";
import { IikoActions } from "./iiko-actions";
import { officeStatusLabelT } from "./filters";
import CanAccess from "@admin/components/can-access";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@admin/components/ui/hover-card";


// Закрыт/Отменён — заказ больше не висит; после ре-синка из iiko такие строки
// гасим визуально, но не удаляем: в status/comment лежит ручная работа менеджеров.
const FINAL_ORDER_STATUSES = ["Closed", "Cancelled"];

// Этапы доставки в порядке прохождения. iiko отдаёт отметку времени на каждый;
// последняя заполненная и есть место, где заказ встал.
// Подписи этапов — hangingOrders.stages.<key>.label / .next (у последнего next нет).
const STAGES = [
    { key: "whenPrinted", hasNext: true },
    { key: "whenCookingCompleted", hasNext: true },
    { key: "whenSended", hasNext: true },
    { key: "whenDelivered", hasNext: true },
    { key: "whenClosed", hasNext: false },
] as const;

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

export function useHangingOrdersColumns(): ColumnDef<typeof hangingOrders.$inferSelect>[] {
    const t = useTranslations("hangingOrders");

    return useMemo<ColumnDef<typeof hangingOrders.$inferSelect>[]>(() => [
    {
        accessorKey: "brand",
        header: t("columns.brand"),
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
        header: t("columns.date"),
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
        header: t("columns.id"),
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
        header: t("columns.conception"),
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
        header: () => <span title={t("columns.orderTypeTitle")}>{t("columns.orderType")}</span>,
        cell: ({ row }) => {
            const orderType = row.getValue("orderType") as string;
            if (!orderType) return "";
            // "Доставка курьером" распирала колонку шире всех остальных значений.
            const short = orderType.replace(/^Доставка курьером$/, t("courierShort"));
            return <span title={orderType}>{short}</span>;
        },
    },
    {
        accessorKey: "paymentType",
        header: () => <span title={t("columns.paymentTypeTitle")}>{t("columns.paymentType")}</span>,
    },
    {
        accessorKey: "orderStatus",
        header: () => <span title={t("columns.orderStatusTitle")}>{t("columns.orderStatus")}</span>,
        cell: ({ row }) => {
            const orderStatus = row.getValue("orderStatus") as string;

            // Облако считает заказ закрытым, но продажи нет — сам по себе это не
            // статус, а расхождение. Показываем статус по последнему реальному
            // этапу, как его увидят в iikoOffice, а расхождение — значком.
            if (orderStatus === "CloudClosed") {
                const r = row.original;
                const real = r.whenDelivered
                    ? t("officeStatus.delivered")
                    : r.whenSended
                      ? t("officeStatus.onWay")
                      : r.whenCookingCompleted
                        ? t("officeStatus.waiting")
                        : t("officeStatus.new");
                return (
                    <span
                        className="inline-flex items-center gap-1"
                        title={t("columns.cloudClosedTitle")}
                    >
                        {real}
                        <Cloud className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-label={t("columns.cloudClosedAria")} />
                    </span>
                );
            }

            const label = officeStatusLabelT(t, orderStatus);
            return FINAL_ORDER_STATUSES.includes(orderStatus) ? (
                <span className="text-muted-foreground">{label}</span>
            ) : (
                label
            );
        },
    },
    {
        id: "stuckAt",
        header: () => <span title={t("columns.stuckAtTitle")}>{t("columns.stuckAt")}</span>,
        cell: ({ row }) => {
            const record = row.original as Record<string, string | null>;
            const reached = STAGES.filter((s) => record[s.key]);

            // Строка ещё ни разу не обновлялась из iiko — этапов не знаем.
            if (reached.length === 0) {
                return <span className="text-muted-foreground">—</span>;
            }

            const last = reached[reached.length - 1];
            const lastAt = dayjs(record[last.key] as string);
            const time = lastAt.isValid() ? lastAt.format("HH:mm") : "";
            const chain = reached
                .map((s) => {
                    const at = dayjs(record[s.key] as string);
                    return `${t(`stages.${s.key}.label`)} ${at.isValid() ? at.format("DD.MM HH:mm") : "?"}`;
                })
                .join(" → ");
            const done = last.key === "whenClosed";

            return (
                <span
                    className={done ? "text-muted-foreground" : "text-amber-600"}
                    title={last.hasNext ? `${chain}
${t(`stages.${last.key}.next`)}` : chain}
                >
                    {t(`stages.${last.key}.label`)} {time}
                </span>
            );
        },
    },
    {
        accessorKey: "comments",
        header: () => <span title={t("columns.commentsTitle")}>{t("columns.comments")}</span>,
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
                            <p className="font-semibold mb-2">{t("columns.fullComment")}</p>
                            <p className="whitespace-pre-wrap break-words">{comment}</p>
                        </div>
                    </HoverCardContent>
                </HoverCard>
            );
        },
    },
    {
        accessorKey: "amount",
        header: t("columns.amount"),
        cell: ({ row }) => {
            const amount = row.getValue("amount") as string;
            if (!amount) return "";
            
            // Форматируем число с разделением тысячных пробелами
            const formattedAmount = Number(amount).toLocaleString('ru-RU', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            }).replace(/,/g, ' ');
            
            return t("columns.amountValue", { amount: formattedAmount });
        },
    },
    {
        accessorKey: "phoneNumber",
        header: t("columns.phone"),
    },
    {
        accessorKey: "receiptNumber",
        header: () => <span title={t("columns.receiptTitle")}>{t("columns.receipt")}</span>,
    },
    {
        accessorKey: "problem",
        header: t("columns.problem"),
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
                            <p className="font-semibold mb-2">{t("columns.fullProblem")}</p>
                            <p className="whitespace-pre-wrap break-words">{problem}</p>
                        </div>
                    </HoverCardContent>
                </HoverCard>
            );
        },
    },
    {
        accessorKey: "status",
        header: () => <span title={t("columns.processingTitle")}>{t("columns.processing")}</span>,
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
        header: () => <span title={t("columns.noteTitle")}>{t("columns.note")}</span>,
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
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => {
            const record = row.original;

            return (
                <div className="flex items-center space-x-2">
                    <StatusUpdateSheet
                        recordId={record.id}
                        currentStatus={record.status}
                        currentComment={record.comment}
                        trigger={
                            <Button variant="ghost" size="sm" title={t("columns.details")} className="h-7 w-7 p-0">
                                <Eye className="h-4 w-4" />
                            </Button>
                        }
                    />
                    {/* Закрыть/отменить в iiko — только admin и только пока заказ висит. */}
                    {record.orderStatus === "CloudClosed" ? (
                        // Облако считает заказ закрытым — команду оно не примет,
                        // а результат отмены закрытого заказа документация не описывает.
                        <CanAccess permission="hanging_orders.iiko_actions">
                            <span
                                className="whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                                title={t("columns.cashierOnlyTitle")}
                            >
                                {t("columns.cashierOnly")}
                            </span>
                        </CanAccess>
                    ) : (
                        !FINAL_ORDER_STATUSES.includes(record.orderStatus ?? "") && (
                            <CanAccess permission="hanging_orders.iiko_actions">
                                <IikoActions record={record} />
                            </CanAccess>
                        )
                    )}
                </div>
            );
        },
    },
    ], [t]);
}