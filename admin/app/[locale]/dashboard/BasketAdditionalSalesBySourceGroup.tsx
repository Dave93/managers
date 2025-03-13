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
    getFilteredData?: (searchText: string) => ProductSourceData[];
}> = React.memo(({ data, searchQuery, className, sortField, sortDirection, onSort, getFilteredData }) => {
    const t = useTranslations("charts.basketAdditionalSalesBySourceGroup");

    const filteredData = React.useMemo(() => {
        if (!data?.data?.productSources || !data?.data?.sources) return { productMap: new Map(), sources: [] };

        let filtered;
        const sources = [...data.data.sources];

        // Используем getFilteredData если он предоставлен, иначе фильтруем локально
        if (getFilteredData) {
            filtered = getFilteredData(searchQuery);
        } else {
            filtered = [...data.data.productSources];
            // Apply search filter
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                filtered = filtered.filter(item =>
                    item.productName.toLowerCase().includes(query)
                );
            }
        }

        // Group by product
        const productMap = groupDataByProduct(filtered, sources);

        return { productMap, sources };
    }, [data, searchQuery, getFilteredData]);

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
                                <div className="flex items-center">
                                    {t("productName")}
                                </div>
                            </TableHead>
                            {filteredData.sources.map(source => (
                                <React.Fragment key={source}>
                                    <TableHead className="text-center border-l" colSpan={2}>
                                        <div className="flex items-center justify-center">
                                            {source}
                                        </div>
                                    </TableHead>
                                </React.Fragment>
                            ))}
                        </TableRow>
                        <TableRow>
                            <TableHead></TableHead>
                            {filteredData.sources.map(source => (
                                <React.Fragment key={source}>
                                    <TableHead className="text-right border-l">
                                        <div className="flex items-center justify-end">
                                            {t("quantity")}
                                        </div>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <div className="flex items-center justify-end">
                                            {t("totalSales")}
                                        </div>
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
    const [organization, setOrganization] = useState<string>("");
    const [searchQuery, setSearchQuery] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalSearchQuery, setModalSearchQuery] = useState("");
    const [sortField, setSortField] = useState<SortField>(null);
    const [sortDirection, setSortDirection] = useState<SortDirection>(null);

    // Sync modal search query with main search query when opening modal
    useEffect(() => {
        if (isModalOpen) {
            setModalSearchQuery(searchQuery);
        }
    }, [isModalOpen, searchQuery]);

    const queryParams = React.useMemo(() => ({
        startDate: dayjs(startDate).format('YYYY-MM-DD'),
        endDate: dayjs(endDate).format('YYYY-MM-DD'),
        terminals: terminals?.toString(),
        organization: organization ? organization : undefined
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

    // Функция для фильтрации данных на основе текущего поискового запроса
    const getFilteredData = useCallback((searchText: string) => {
        if (!data?.data?.productSources) return [];

        if (!searchText) return data.data.productSources;

        const query = searchText.toLowerCase();
        return data.data.productSources.filter(item =>
            item.productName.toLowerCase().includes(query)
        );
    }, [data]);

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

            // Получаем отфильтрованные данные на основе текущего контекста (модальное окно или основной вид)
            const currentSearchQuery = isModalOpen ? modalSearchQuery : searchQuery;
            const filteredProductSources = getFilteredData(currentSearchQuery);

            // Group data by product
            const productMap = groupDataByProduct(filteredProductSources, data.data.sources);

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

            // Calculate totals for filtered data
            filteredProductSources.forEach(item => {
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
            saveAs(blob, `basket-additional-sales-by-source-group-${dayjs().format('YYYY-MM-DD')}${organization ? `-${organization}` : ''}.csv`);
        } catch (error) {
            console.error("Error exporting to CSV:", error);
        }
    }, [data, searchQuery, modalSearchQuery, isModalOpen, organization, t, getFilteredData]);

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="flex flex-col items-stretch space-y-0 border-b pb-2 sm:flex-row">
                    <div className="flex flex-1 flex-col justify-center px-6 py-2">
                        <CardTitle className="text-sm font-medium">
                            {t("title")}
                        </CardTitle>
                    </div>
                    {!terminals && (
                        <div className="flex mt-2 sm:mt-0">
                            <button
                                data-active={!organization || organization.length == 0}
                                className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t p-2 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0"
                                onClick={() => setOrganization("")}
                            >
                                <span className="text-sm font-bold leading-none">{t('all')}</span>
                            </button>
                            {organizations.map((org) => {
                                return (
                                    <button
                                        key={org.id}
                                        data-active={organization === org.id}
                                        className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t p-2 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0"
                                        onClick={() => setOrganization(org.id)}
                                    >
                                        <span className="text-sm font-bold leading-none">
                                            {org.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    <div className="flex space-x-2 mt-2 sm:mt-0 justify-end px-6 py-2">
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
                        <div className="px-2">
                            <SearchInput
                                value={searchQuery}
                                onChange={setSearchQuery}
                            />
                        </div>
                        <BasketSalesBySourceGroupTable
                            data={data}
                            searchQuery={searchQuery}
                            sortField={sortField}
                            sortDirection={sortDirection}
                            onSort={handleSort}
                            getFilteredData={getFilteredData}
                        />
                    </div>
                </CardContent>
            </Card>

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="max-w-5xl h-[80vh] flex flex-col">
                    <DialogHeader className="pb-2 border-b">
                        <DialogTitle>{t("title")}</DialogTitle>
                        {!terminals && (
                            <div className="flex mt-2 border-t sm:border-t-0">
                                <button
                                    data-active={!organization || organization.length == 0}
                                    className="relative z-30 flex flex-1 flex-col justify-center gap-1 p-2 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l"
                                    onClick={() => setOrganization("")}
                                >
                                    <span className="text-sm font-bold leading-none">{t('all')}</span>
                                </button>
                                {organizations.map((org) => {
                                    return (
                                        <button
                                            key={org.id}
                                            data-active={organization === org.id}
                                            className="relative z-30 flex flex-1 flex-col justify-center gap-1 p-2 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l"
                                            onClick={() => setOrganization(org.id)}
                                        >
                                            <span className="text-sm font-bold leading-none">
                                                {org.label}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </DialogHeader>
                    <div className="flex-1 overflow-hidden flex flex-col space-y-4 py-4">
                        <div className="px-4">
                            <SearchInput
                                value={modalSearchQuery}
                                onChange={setModalSearchQuery}
                            />
                        </div>
                        <div className="flex-1 overflow-hidden flex flex-col">
                            <BasketSalesBySourceGroupTable
                                data={data}
                                searchQuery={modalSearchQuery}
                                className="h-full"
                                sortField={sortField}
                                sortDirection={sortDirection}
                                onSort={handleSort}
                                getFilteredData={getFilteredData}
                            />
                        </div>
                        <div className="flex justify-end pt-2">
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