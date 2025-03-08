import { apiClient } from "@admin/utils/eden";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, TableFooter } from "@admin/components/ui/table";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import React, { useState, useCallback, useEffect } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@admin/components/ui/card";
import { organizations } from "@admin/lib/organizations";
import { useTranslations } from "next-intl";
import { Input } from "@admin/components/ui/input";
import { Search, X, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import dayjs from "dayjs";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@admin/components/ui/dialog";
import { cn } from "@admin/lib/utils";
import { saveAs } from 'file-saver';

interface ProductSalesData {
    name: string;
    quantity: number;
    totalSales: number;
}

interface BasketAdditionalSalesResponse {
    data: {
        products: ProductSalesData[];
    };
    debug: {
        sqlQueryTime: number;
        apiTime: number;
    };
}

const fetchBasketAdditionalSales = async (
    startDate: string,
    endDate: string,
    terminals?: string,
    organization?: string,
) => {
    if (!startDate || !endDate) {
        throw new Error("Date filter is mandatory");
    }

    let query: {
        startDate: string;
        endDate: string;
        terminals?: string | undefined;
        organization?: string | undefined;
    } = {
        startDate,
        endDate,
    };

    if (terminals) {
        query = {
            ...query,
            terminals,
        };
    }

    if (organization) {
        query = {
            ...query,
            organization,
        };
    }

    const { data, status } = await apiClient.api.charts["basket-additional-sales"].get({
        query
    });

    if (status !== 200 || !data) {
        throw new Error("Failed to fetch basket additional sales");
    }

    return data as BasketAdditionalSalesResponse;
}

type SortDirection = 'asc' | 'desc' | null;
type SortField = 'name' | 'quantity' | 'totalSales' | null;

const BasketSalesTable: React.FC<{
    data: BasketAdditionalSalesResponse | undefined;
    searchQuery: string;
    className?: string;
    sortField?: SortField;
    sortDirection?: SortDirection;
    onSort?: (field: SortField, direction: SortDirection) => void;
}> = React.memo(({ data, searchQuery, className, sortField, sortDirection, onSort }) => {
    const t = useTranslations("charts.basketAdditionalSales");

    const filteredProducts = React.useMemo(() => {
        if (!data?.data?.products) return [];

        let filtered = [...data.data.products];

        // Apply search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(product =>
                product.name.toLowerCase().includes(query)
            );
        }

        // Apply sorting
        if (sortField && sortDirection) {
            filtered.sort((a, b) => {
                let comparison = 0;

                if (sortField === 'name') {
                    comparison = a.name.localeCompare(b.name);
                } else if (sortField === 'quantity') {
                    comparison = a.quantity - b.quantity;
                } else if (sortField === 'totalSales') {
                    comparison = a.totalSales - b.totalSales;
                }

                return sortDirection === 'asc' ? comparison : -comparison;
            });
        }

        return filtered;
    }, [data, searchQuery, sortField, sortDirection]);

    const handleHeaderClick = (field: SortField) => {
        if (!onSort) return;

        if (sortField === field) {
            if (sortDirection === 'asc') {
                onSort(field, 'desc');
            } else if (sortDirection === 'desc') {
                onSort(null, null);
            } else {
                onSort(field, 'asc');
            }
        } else {
            onSort(field, 'asc');
        }
    };

    const getSortIcon = (field: SortField) => {
        if (sortField !== field) {
            return <ArrowUpDown className="ml-2 h-4 w-4" />;
        }

        if (sortDirection === 'asc') {
            return <ArrowUp className="ml-2 h-4 w-4" />;
        }

        if (sortDirection === 'desc') {
            return <ArrowDown className="ml-2 h-4 w-4" />;
        }

        return <ArrowUpDown className="ml-2 h-4 w-4" />;
    };

    // Calculate totals for footer
    const totalQuantity = React.useMemo(() =>
        filteredProducts.reduce((sum, product) => sum + product.quantity, 0),
        [filteredProducts]);

    const totalSales = React.useMemo(() =>
        filteredProducts.reduce((sum, product) => sum + product.totalSales, 0),
        [filteredProducts]);

    if (!data?.data?.products) {
        return <div>No data available</div>;
    }

    return (
        <div className={cn("rounded-md border flex flex-col", className)}>
            <div className="overflow-auto max-h-[450px] flex-grow relative">
                <Table className="relative">
                    <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                            <TableHead
                                className="cursor-pointer"
                                onClick={() => handleHeaderClick('name')}
                            >
                                {t("productName")}
                                {getSortIcon('name')}
                            </TableHead>
                            <TableHead
                                className="cursor-pointer text-right"
                                onClick={() => handleHeaderClick('quantity')}
                            >
                                {t("quantity")}
                                {getSortIcon('quantity')}
                            </TableHead>
                            <TableHead
                                className="cursor-pointer text-right"
                                onClick={() => handleHeaderClick('totalSales')}
                            >
                                {t("totalSales")}
                                {getSortIcon('totalSales')}
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredProducts.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={3} className="h-24 text-center">
                                    {searchQuery ? t("noResults") : t("noResults")}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredProducts.map((product, index) => (
                                <TableRow key={`${product.name}-${index}`}>
                                    <TableCell className="font-medium">{product.name}</TableCell>
                                    <TableCell className="text-right">{product.quantity}</TableCell>
                                    <TableCell className="text-right">{formatNumber(product.totalSales)}</TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                    <TableFooter className="sticky bottom-0 bg-background z-10 text-black">
                        <TableRow>
                            <TableCell className="font-extrabold">{t("total")}</TableCell>
                            <TableCell className="text-right font-extrabold">{totalQuantity}</TableCell>
                            <TableCell className="text-right font-extrabold">{formatNumber(totalSales)}</TableCell>
                        </TableRow>
                    </TableFooter>
                </Table>
            </div>
        </div>
    );
});

BasketSalesTable.displayName = 'BasketSalesTable';

// Search input component
const SearchInput = React.memo(({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
    const t = useTranslations("charts.basketAdditionalSales");
    const inputRef = React.useRef<HTMLInputElement>(null);

    return (
        <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
                ref={inputRef}
                placeholder={t("searchPlaceholder")}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="pl-8 pr-8"
            />
            {value && (
                <button
                    onClick={() => {
                        onChange("");
                        inputRef.current?.focus();
                    }}
                    className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground"
                    type="button"
                >
                    <X className="h-4 w-4" />
                </button>
            )}
        </div>
    );
});

SearchInput.displayName = 'SearchInput';

// Функция для форматирования чисел с разделителями тысяч
const formatNumber = (value: number): string => {
    return new Intl.NumberFormat('ru-RU', {
        style: 'decimal',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: true
    }).format(value);
};

const BasketAdditionalSales = () => {
    const t = useTranslations("charts.basketAdditionalSales");
    const { dateRange } = useDateRangeState();
    const { startDate, endDate } = React.useMemo(() => ({
        startDate: dateRange?.from ?? new Date(),
        endDate: dateRange?.to ?? new Date()
    }), [dateRange]);
    const [terminals] = useTerminalsFilter();
    const [organization, setOrganization] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalSearchQuery, setModalSearchQuery] = useState("");
    const [sortField, setSortField] = useState<SortField>(null);
    const [sortDirection, setSortDirection] = useState<SortDirection>(null);
    const [filteredProducts, setFilteredProducts] = useState<ProductSalesData[]>([]);

    const queryParams = React.useMemo(() => ({
        startDate: dayjs(startDate).format('YYYY-MM-DD'),
        endDate: dayjs(endDate).format('YYYY-MM-DD'),
        terminals: terminals?.toString(),
        organization: organization ?? undefined
    }), [startDate, endDate, terminals, organization]);

    const { data } = useSuspenseQuery<BasketAdditionalSalesResponse>({
        queryKey: ["basket-additional-sales", queryParams],
        queryFn: async () => {
            const response = await fetchBasketAdditionalSales(
                queryParams.startDate,
                queryParams.endDate,
                queryParams.terminals,
                queryParams.organization
            );
            return response;
        },
    });

    const { data: terminalsData } = useQuery({
        queryKey: [
            "filter_terminals"
        ],
        queryFn: async () => {
            const { data } = await apiClient.api.terminals.my_terminals.get();
            return data;
        },
    });

    const [selectedTerminal, setSelectedTerminal] = useTerminalsFilter();

    const handleSort = React.useCallback((field: SortField, direction: SortDirection) => {
        setSortField(field);
        setSortDirection(direction);
    }, []);

    const exportToCSV = React.useCallback(() => {
        if (!data?.data) return;

        try {
            // Создаем заголовки с BOM для правильной кодировки в Excel
            const BOM = "\uFEFF";
            const headers = [t("productName"), t("quantity"), t("totalSales")];

            // Создаем строки данных
            const rows = filteredProducts.map(product => [
                product.name,
                product.quantity,
                formatNumber(product.totalSales)
            ]);

            // Добавляем строку с итогами
            const totalQuantity = filteredProducts.reduce((sum, product) => sum + product.quantity, 0);
            const totalSales = filteredProducts.reduce((sum, product) => sum + product.totalSales, 0);
            rows.push([t("total"), totalQuantity, formatNumber(totalSales)]);

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
            saveAs(blob, `basket-additional-sales-${dayjs().format('YYYY-MM-DD')}.csv`);
        } catch (error) {
            console.error("Error exporting to CSV:", error);
        }
    }, [data, filteredProducts]);

    // Update filtered products when data or search query changes
    useEffect(() => {
        if (!data?.data?.products) {
            setFilteredProducts([]);
            return;
        }

        let filtered = [...data.data.products];

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(product =>
                product.name.toLowerCase().includes(query)
            );
        }

        if (sortField && sortDirection) {
            filtered.sort((a, b) => {
                let comparison = 0;

                if (sortField === 'name') {
                    comparison = a.name.localeCompare(b.name);
                } else if (sortField === 'quantity') {
                    comparison = a.quantity - b.quantity;
                } else if (sortField === 'totalSales') {
                    comparison = a.totalSales - b.totalSales;
                }

                return sortDirection === 'asc' ? comparison : -comparison;
            });
        }

        setFilteredProducts(filtered);
    }, [data, searchQuery, sortField, sortDirection]);

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        {t("title")}
                    </CardTitle>
                    <div className="flex space-x-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={exportToCSV}
                            disabled={!data?.data?.products || data.data.products.length === 0}
                        >
                            {t("exportToCSV")}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsModalOpen(true)}
                        >
                            {t("fullScreen")}
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <SearchInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                        />
                        <BasketSalesTable
                            data={data}
                            searchQuery={searchQuery}
                            sortField={sortField}
                            sortDirection={sortDirection}
                            onSort={handleSort}
                        />
                    </div>
                </CardContent>
            </Card>

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="max-w-5xl h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>{t("title")}</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-hidden flex flex-col space-y-4 py-4">
                        <SearchInput
                            value={modalSearchQuery}
                            onChange={setModalSearchQuery}
                        />
                        <div className="flex-1 overflow-hidden flex flex-col">
                            <BasketSalesTable
                                data={data}
                                searchQuery={modalSearchQuery}
                                className="h-full"
                                sortField={sortField}
                                sortDirection={sortDirection}
                                onSort={handleSort}
                            />
                        </div>
                        <div className="flex justify-end">
                            <Button
                                variant="outline"
                                onClick={exportToCSV}
                                disabled={!data?.data?.products || data.data.products.length === 0}
                            >
                                {t("exportToCSV")}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default BasketAdditionalSales; 