import dayjs from "dayjs";
import type { DateRange } from "react-day-picker";

/** Заказ в этих статусах уже не висит — филиал закрыл или отменил его. */
export const FINAL_ORDER_STATUSES = ["Closed", "Cancelled"];

/** Фильтры из шапки таблицы, по одному на колонку. */
export type ColumnFilters = {
    conception?: string;
    orderType?: string;
    paymentType?: string;
    orderStatus?: string;
    comments?: string;
    amountFrom?: string;
    phoneNumber?: string;
    receiptNumber?: string;
    problem?: string;
    comment?: string;
};

export type FilterInput = {
    brandFilter?: string;
    statusFilter?: string;
    searchTerm?: string;
    dateRange?: DateRange;
    hideClosed?: boolean;
    columnFilters?: ColumnFilters;
};

type Filter = { field: string; operator: string; value: unknown };

// Подстрочный поиск — там, где значения свободные.
const CONTAINS: (keyof ColumnFilters)[] = [
    "conception",
    "comments",
    "phoneNumber",
    "receiptNumber",
    "problem",
    "comment",
];

// Точное совпадение — там, где значения берутся из выпадающего списка.
const EQUALS: (keyof ColumnFilters)[] = [
    "orderType",
    "paymentType",
    "orderStatus",
];

/**
 * Собирает массив фильтров для списочных эндпоинтов. Один источник правды:
 * им пользуются и таблица, и экспорт, и справочник значений — иначе выгрузка
 * расходится с тем, что видно на экране.
 */
export function buildFilters(input: FilterInput): Filter[] {
    const out: Filter[] = [];
    const { brandFilter, statusFilter, searchTerm, dateRange, hideClosed } = input;
    const cols = input.columnFilters ?? {};

    if (brandFilter && brandFilter !== "all") {
        out.push({ field: "brand", operator: "eq", value: brandFilter });
    }

    if (statusFilter && statusFilter !== "all") {
        out.push({ field: "status", operator: "eq", value: statusFilter });
    }

    // Явный выбор статуса заказа важнее тумблера «скрыть закрытые»:
    // иначе выбор «Закрыт» давал бы заведомо пустую выдачу.
    if (hideClosed && !cols.orderStatus) {
        out.push({
            field: "orderStatus",
            operator: "notIn",
            value: FINAL_ORDER_STATUSES,
        });
    }

    if (searchTerm) {
        out.push({ field: "orderId", operator: "contains", value: searchTerm });
    }

    if (dateRange?.from) {
        out.push({
            field: "date",
            operator: "gte",
            value: dayjs(dateRange.from).format("YYYY-MM-DD"),
        });
    }

    if (dateRange?.to) {
        out.push({
            field: "date",
            operator: "lte",
            value: dayjs(dateRange.to).format("YYYY-MM-DD"),
        });
    }

    for (const field of CONTAINS) {
        const value = cols[field]?.trim();
        if (value) out.push({ field, operator: "contains", value });
    }

    for (const field of EQUALS) {
        const value = cols[field];
        if (value && value !== "all") out.push({ field, operator: "eq", value });
    }

    const from = cols.amountFrom?.trim();
    if (from && Number.isFinite(Number(from))) {
        out.push({ field: "amount", operator: "gte", value: from });
    }

    return out;
}

export function buildFiltersJson(input: FilterInput): string | undefined {
    const list = buildFilters(input);

    return list.length > 0 ? JSON.stringify(list) : undefined;
}

/** Есть ли хоть один заданный колоночный фильтр — для кнопки сброса. */
export function hasColumnFilters(cols: ColumnFilters | undefined): boolean {
    if (!cols) return false;

    return Object.values(cols).some(
        (v) => typeof v === "string" && v.trim() !== "" && v !== "all",
    );
}
