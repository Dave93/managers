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

interface ProductSourceData {
    productName: string;
    sourceName: string;
    quantity: number;
    totalSales: number;
}

interface BasketAdditionalSalesBySourceGroupResponse {
    data: {
        productSources: ProductSourceData[];
        sources: string[];
    };
    debug: {
        sqlQueryTime: number;
        apiTime: number;
    };
}

const fetchBasketAdditionalSalesBySourceGroup = async (
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

    const { data, status } = await apiClient.api.charts["basket-additional-sales-by-source-group"].get({
        query
    });

    if (status !== 200 || !data) {
        throw new Error("Failed to fetch basket additional sales by source group");
    }

    return data as BasketAdditionalSalesBySourceGroupResponse;
}

type SortDirection = 'asc' | 'desc' | null;
type SortField = 'productName' | 'sourceName' | 'quantity' | 'totalSales' | null;

// Helper function to group data by product
const groupDataByProduct = (data: ProductSourceData[], sources: string[]) => {
    const productMap = new Map<string, { [source: string]: { quantity: number, totalSales: number } }>();

    // Initialize map with all products and sources
    data.forEach(item => {
        if (!productMap.has(item.productName)) {
            const sourceData: { [source: string]: { quantity: number, totalSales: number } } = {};
            sources.forEach(source => {
                sourceData[source] = { quantity: 0, totalSales: 0 };
            });
            productMap.set(item.productName, sourceData);
        }
    });

    // Fill in the data
    data.forEach(item => {
        const productData = productMap.get(item.productName);
        if (productData && productData[item.sourceName]) {
            productData[item.sourceName] = {
                quantity: item.quantity,
                totalSales: item.totalSales
            };
        }
    });

    return productMap;
};

const BasketSalesBySourceGroupTable: React.FC<{
    data: BasketAdditionalSalesBySourceGroupResponse | undefined;
    searchQuery: string;
    className?: string;
    sortField?: SortField;
    sortDirection?: SortDirection;
    onSort?: (field: SortField, direction: SortDirection) => void;
}> = React.memo(({ data, searchQuery, className, sortField, sortDirection, onSort }) => {
    const t = useTranslations("charts.basketAdditionalSalesBySourceGroup");

    const filteredData = React.useMemo(() => {
        if (!data?.data?.productSources || !data?.data?.sources) return { productMap: new Map(), sources: [] };

        let filtered = [...data.data.productSources];
        const sources = [...data.data.sources];

        // Apply search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(item =>
                item.productName.toLowerCase().includes(query)
            );
        }

        // Group by product
        const productMap = groupDataByProduct(filtered, sources);

        return { productMap, sources };
    }, [data, searchQuery]);

    // Calculate totals for footer
    const totals = React.useMemo(() => {
        if (!filteredData.productMap || !filteredData.sources) return {};

        const sourceTotals: { [source: string]: { quantity: number, totalSales: number } } = {};

        // Initialize totals for each source
        filteredData.sources.forEach(source => {
            sourceTotals[source] = { quantity: 0, totalSales: 0 };
        });

        // Calculate totals
        filteredData.productMap.forEach(productData => {
            filteredData.sources.forEach(source => {
                sourceTotals[source].quantity += productData[source]?.quantity || 0;
                sourceTotals[source].totalSales += productData[source]?.totalSales || 0;
            });
        });

        return sourceTotals;
    }, [filteredData]);

    if (!data?.data?.productSources || !data?.data?.sources) {
        return <div>No data available</div>;
    }

    return (
        <div className={cn("rounded-md border flex flex-col", className)}>
            <div className="overflow-auto max-h-[400px] flex-grow relative">
                <Table className="relative">
                    <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                            <TableHead className="cursor-pointer">
                                {t("productName")}
                            </TableHead>
                            {filteredData.sources.map(source => (
                                <React.Fragment key={source}>
                                    <TableHead className="text-center border-l" colSpan={2}>
                                        {source}
                                    </TableHead>
                                </React.Fragment>
                            ))}
                        </TableRow>
                        <TableRow>
                            <TableHead></TableHead>
                            {filteredData.sources.map(source => (
                                <React.Fragment key={source}>
                                    <TableHead className="text-right border-l">
                                        {t("quantity")}
                                    </TableHead>
                                    <TableHead className="text-right">
                                        {t("totalSales")}
                                    </TableHead>
                                </React.Fragment>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredData.productMap.size === 0 ? (
                            <TableRow>
                                <TableCell colSpan={1 + filteredData.sources.length * 2} className="h-24 text-center">
                                    {searchQuery ? t("noResults") : t("noResults")}
                                </TableCell>
                            </TableRow>
                        ) : (
                            Array.from(filteredData.productMap.entries()).map(([productName, sourceData], index) => (
                                <TableRow key={`${productName}-${index}`}>
                                    <TableCell className="font-medium">{productName}</TableCell>
                                    {filteredData.sources.map(source => (
                                        <React.Fragment key={`${productName}-${source}`}>
                                            <TableCell className="text-right border-l">
                                                {sourceData[source]?.quantity || 0}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {formatNumber(sourceData[source]?.totalSales || 0)}
                                            </TableCell>
                                        </React.Fragment>
                                    ))}
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                    <TableFooter className="sticky bottom-0 bg-background z-10 text-black">
                        <TableRow>
                            <TableCell className="font-extrabold">{t("total")}</TableCell>
                            {filteredData.sources.map(source => (
                                <React.Fragment key={`total-${source}`}>
                                    <TableCell className="text-right font-extrabold border-l">
                                        {totals[source]?.quantity || 0}
                                    </TableCell>
                                    <TableCell className="text-right font-extrabold">
                                        {formatNumber(totals[source]?.totalSales || 0)}
                                    </TableCell>
                                </React.Fragment>
                            ))}
                        </TableRow>
                    </TableFooter>
                </Table>
            </div>
        </div>
    );
});

BasketSalesBySourceGroupTable.displayName = 'BasketSalesBySourceGroupTable';

// Search input component
const SearchInput = React.memo(({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
    const t = useTranslations("charts.basketAdditionalSalesBySourceGroup");
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

const BasketAdditionalSalesBySourceGroup = () => {
    const t = useTranslations("charts.basketAdditionalSalesBySourceGroup");
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

    const queryParams = React.useMemo(() => ({
        startDate: dayjs(startDate).format('YYYY-MM-DD'),
        endDate: dayjs(endDate).format('YYYY-MM-DD'),
        terminals: terminals?.toString(),
        organization: organization ?? undefined
    }), [startDate, endDate, terminals, organization]);

    const { data } = useSuspenseQuery<BasketAdditionalSalesBySourceGroupResponse>({
        queryKey: ["basket-additional-sales-by-source-group", queryParams],
        queryFn: async () => {
            const response = await fetchBasketAdditionalSalesBySourceGroup(
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

            // Create headers with product name and pairs of quantity/total sales for each source
            const headers = [t("productName")];
            data.data.sources.forEach(source => {
                headers.push(`${source} - ${t("quantity")}`, `${source} - ${t("totalSales")}`);
            });

            // Group data by product
            const productMap = groupDataByProduct(data.data.productSources, data.data.sources);

            // Create rows
            const rows = Array.from(productMap.entries()).map(([productName, sourceData]) => {
                const row = [productName];
                data.data.sources.forEach(source => {
                    row.push(
                        String(sourceData[source]?.quantity || 0),
                        formatNumber(sourceData[source]?.totalSales || 0)
                    );
                });
                return row;
            });

            // Add totals row
            const totalsRow = [t("total")];
            const sourceTotals: { [source: string]: { quantity: number, totalSales: number } } = {};

            // Initialize totals
            data.data.sources.forEach(source => {
                sourceTotals[source] = { quantity: 0, totalSales: 0 };
            });

            // Calculate totals
            data.data.productSources.forEach(item => {
                if (sourceTotals[item.sourceName]) {
                    sourceTotals[item.sourceName].quantity += item.quantity;
                    sourceTotals[item.sourceName].totalSales += item.totalSales;
                }
            });

            // Add totals to row
            data.data.sources.forEach(source => {
                totalsRow.push(
                    String(sourceTotals[source]?.quantity || 0),
                    formatNumber(sourceTotals[source]?.totalSales || 0)
                );
            });

            rows.push(totalsRow);

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
            saveAs(blob, `basket-additional-sales-by-source-group-${dayjs().format('YYYY-MM-DD')}.csv`);
        } catch (error) {
            console.error("Error exporting to CSV:", error);
        }
    }, [data]);

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
                            disabled={!data?.data?.productSources || data.data.productSources.length === 0}
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
                        <BasketSalesBySourceGroupTable
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
                            <BasketSalesBySourceGroupTable
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
                                disabled={!data?.data?.productSources || data.data.productSources.length === 0}
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

export default BasketAdditionalSalesBySourceGroup; 