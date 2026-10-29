import dayjs from "dayjs";
import type { DateRange } from "react-day-picker";

/** Заказ в этих статусах уже не висит — филиал закрыл или отменил его. */
export const FINAL_ORDER_STATUSES = ["Closed", "Cancelled"];

/**
 * Статусы так, как их показывает iikoOffice. Храним статус iikoCloud, а он
 * дробит «Новую» на кухонные этапы — бэк-офис их не различает: для него заказ
 * новый, пока его не отдали курьеру. Кухонный этап виден в «Застрял на».
 * label — русская подпись для CSV; в UI подписи берутся из переводов по key.
 */
export const OFFICE_STATUSES = [
    {
        key: "new",
        label: "Новая",
        values: ["Unconfirmed", "WaitCooking", "ReadyForCooking", "CookingStarted", "CookingCompleted"],
    },
    { key: "waiting", label: "Ждет отправки", values: ["Waiting"] },
    { key: "onWay", label: "В пути", values: ["OnWay"] },
    { key: "delivered", label: "Доставлена", values: ["Delivered"] },
    { key: "closed", label: "Закрыта", values: ["Closed"] },
    // iikoCloud пометил Closed, а продажи в iikoServer нет: на кассе заказ висит.
    { key: "cloudClosed", label: "Закрыт только в облаке", values: ["CloudClosed"] },
    { key: "cancelled", label: "Отменена", values: ["Cancelled"] },
];

export const officeStatusOf = (raw: string | null | undefined) =>
    OFFICE_STATUSES.find((s) => s.values.includes(raw ?? ""));

/**
 * Русская подпись статуса — только для CSV-экспорта (он остаётся по-русски).
 * Для интерфейса используйте officeStatusLabelT.
 */
export const officeStatusLabel = (raw: string | null | undefined) =>
    officeStatusOf(raw)?.label ?? raw ?? "";

/** Переводит подпись статуса iikoOffice для UI (ключи hangingOrders.officeStatus.*). */
export const officeStatusLabelT = (
    t: (key: string) => string,
    raw: string | null | undefined,
) => {
    const status = officeStatusOf(raw);
    return status ? t(`officeStatus.${status.key}`) : raw ?? "";
};

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
    // иначе выбор «Закрыт» давал бы заведомо пустую выдачу. «Все» — это не
    // выбор: раньше `!cols.orderStatus` считал "all" выбором, и тумблер
    // переставал работать, стоило открыть фильтр и вернуть «Все».
    const statusPicked = !!cols.orderStatus && cols.orderStatus !== "all";
    if (hideClosed && !statusPicked) {
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

    // Статус выбирается группой iikoOffice: «Новая» — это пять статусов облака.
    const group = OFFICE_STATUSES.find((s) => s.key === cols.orderStatus);
    if (group) {
        out.push({ field: "orderStatus", operator: "in", value: group.values });
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
