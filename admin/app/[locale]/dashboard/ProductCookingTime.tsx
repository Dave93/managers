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
import { Search, X } from "lucide-react";
import dayjs from "dayjs";
import { Button } from "@admin/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@admin/components/ui/dialog";
import { cn } from "@admin/lib/utils";

interface DishData {
    name: string;
    values: number[];
    total?: number;
}

interface CookingTimeResponse {
    data: {
        timeRanges: string[];
        dishes: DishData[];
    };
    debug: {
        sqlQueryTime: number;
        apiTime: number;
    };
}

const fetchProductCookingTime = async (
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

    const response = await apiClient.api.charts["cooking-time-distribution"].get({
        query
    });

    if (response.status !== 200 || !response.data) {
        throw new Error("Failed to fetch product cooking time");
    }

    return response.data as CookingTimeResponse;
}

type SortDirection = 'asc' | 'desc' | null;
type SortField = 'name' | number | null;

const CookingTimeTable: React.FC<{
    data: CookingTimeResponse | undefined;
    searchQuery: string;
    className?: string;
    sortField?: SortField;
    sortDirection?: SortDirection;
    onSort?: (field: SortField, direction: SortDirection) => void;
    showHeatmap?: boolean;
    perDishHeatmap?: boolean;
}> = React.memo(({
    data,
    searchQuery,
    className,
    sortField = null,
    sortDirection = null,
    onSort = () => { },
    showHeatmap = false,
    perDishHeatmap = true
}) => {
    const t = useTranslations("");
    const tableRef = React.useRef<HTMLDivElement>(null);
    const [visibleRows, setVisibleRows] = useState(50);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const dishesWithTotal = React.useMemo(() => {
        if (!data?.data?.dishes) return [];
        return data.data.dishes.map(dish => ({
            ...dish,
            total: dish.values.reduce((sum, value) => sum + value, 0)
        }));
    }, [data?.data?.dishes]);

    const filteredAndSortedDishes = React.useMemo(() => {
        if (!dishesWithTotal.length) return [];

        let filtered = dishesWithTotal.filter(dish =>
            dish.name.toLowerCase().includes(searchQuery.toLowerCase())
        );

        if (sortField !== null && sortDirection !== null) {
            filtered = [...filtered].sort((a, b) => {
                if (sortField === 'name') {
                    return sortDirection === 'asc'
                        ? a.name.localeCompare(b.name)
                        : b.name.localeCompare(a.name);
                } else if (typeof sortField === 'number') {
                    const aValue = a.values[sortField] || 0;
                    const bValue = b.values[sortField] || 0;
                    return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
                } else if (sortField === 'total') {
                    const aTotal = a.total || 0;
                    const bTotal = b.total || 0;
                    return sortDirection === 'asc' ? aTotal - bTotal : bTotal - aTotal;
                }
                return 0;
            });
        }

        return filtered;
    }, [dishesWithTotal, searchQuery, sortField, sortDirection]);

    const maxValue = React.useMemo(() => {
        if (!data?.data?.dishes) return 0;
        return Math.max(...data.data.dishes.flatMap(dish => dish.values));
    }, [data?.data?.dishes]);

    const dishMaxValues = React.useMemo(() => {
        if (!dishesWithTotal.length) return {};
        return dishesWithTotal.reduce((acc, dish) => {
            acc[dish.name] = Math.max(...dish.values);
            return acc;
        }, {} as Record<string, number>);
    }, [dishesWithTotal]);

    const getHeatmapColor = React.useCallback((value: number, dishName: string) => {
        if (!showHeatmap || value === 0) return '';

        if (perDishHeatmap) {
            const dishMax = dishMaxValues[dishName] || 1;
            const intensity = Math.min(value / dishMax, 1);
            return `rgba(59, 130, 246, ${intensity * 0.5})`;
        } else {
            const intensity = Math.min(value / maxValue, 1);
            return `rgba(59, 130, 246, ${intensity * 0.5})`;
        }
    }, [showHeatmap, perDishHeatmap, dishMaxValues, maxValue]);

    const handleHeaderClick = (field: SortField) => {
        if (sortField === field) {
            onSort(field, sortDirection === 'asc' ? 'desc' : sortDirection === 'desc' ? null : 'asc');
        } else {
            onSort(field, 'asc');
        }
    };

    const getSortIcon = (field: SortField) => {
        if (sortField === field) {
            if (sortDirection === 'asc') return '↑';
            if (sortDirection === 'desc') return '↓';
        }
        return <span className="text-muted-foreground ml-1 opacity-40">↕</span>;
    };

    // Функция для загрузки дополнительных строк
    const loadMoreRows = useCallback(() => {
        if (filteredAndSortedDishes.length <= visibleRows) return;

        setIsLoadingMore(true);
        // Имитируем загрузку данных
        setTimeout(() => {
            setVisibleRows(prev => Math.min(prev + 50, filteredAndSortedDishes.length));
            setIsLoadingMore(false);
        }, 300);
    }, [filteredAndSortedDishes.length, visibleRows]);

    // Обработчик прокрутки
    const handleScroll = useCallback(() => {
        if (!tableRef.current || isLoadingMore) return;

        const { scrollTop, scrollHeight, clientHeight } = tableRef.current;
        // Если прокрутили до конца (с небольшим запасом), загружаем еще строки
        if (scrollTop + clientHeight >= scrollHeight - 100) {
            loadMoreRows();
        }
    }, [loadMoreRows, isLoadingMore]);

    // Устанавливаем обработчик прокрутки
    useEffect(() => {
        const tableElement = tableRef.current;
        if (tableElement) {
            tableElement.addEventListener('scroll', handleScroll);
            return () => {
                tableElement.removeEventListener('scroll', handleScroll);
            };
        }
    }, [handleScroll]);

    // Сбрасываем количество видимых строк при изменении фильтров
    useEffect(() => {
        setVisibleRows(50);
    }, [searchQuery, sortField, sortDirection]);

    const renderTableRows = () => {
        if (filteredAndSortedDishes.length === 0) {
            return (
                <TableRow>
                    <TableCell colSpan={data?.data.timeRanges.length ? data.data.timeRanges.length + 2 : 3} className="text-center py-4">
                        {t('charts.ProductCookingTime.noResults')}
                    </TableCell>
                </TableRow>
            );
        }

        const rowsToRender = filteredAndSortedDishes.slice(0, visibleRows);

        return (
            <React.Fragment>
                {rowsToRender.map((dish) => (
                    <TableRow key={dish.name}>
                        <TableCell className="sticky left-0 bg-background font-medium">
                            {dish.name}
                        </TableCell>
                        {data.data.timeRanges.map((timeRange, index) => (
                            <TableCell
                                key={`${dish.name}-${timeRange}`}
                                className="min-w-[80px]"
                                style={{ backgroundColor: getHeatmapColor(dish.values[index], dish.name) }}
                            >
                                {dish.values[index]}
                            </TableCell>
                        ))}
                        <TableCell className="min-w-[80px] font-medium bg-muted/30 text-foreground">
                            {dish.total}
                        </TableCell>
                    </TableRow>
                ))}
                {visibleRows < filteredAndSortedDishes.length && (
                    <TableRow>
                        <TableCell colSpan={data.data.timeRanges.length + 2} className="text-center py-4">
                            {isLoadingMore
                                ? t('charts.ProductCookingTime.loading')
                                : t('charts.ProductCookingTime.scrollToLoadMore')}
                        </TableCell>
                    </TableRow>
                )}
            </React.Fragment>
        );
    };

    if (!data?.data) return null;

    return (
        <div className={cn("overflow-x-auto", className)} ref={tableRef}>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead
                            className="sticky left-0 bg-background w-[200px] cursor-pointer hover:bg-muted/50 transition-colors group"
                            onClick={() => handleHeaderClick('name')}
                        >
                            <div className="flex items-center">
                                {t('charts.ProductCookingTime.dishName')}
                                <span className={cn(
                                    "ml-1",
                                    sortField === 'name' ? "text-foreground" : "text-muted-foreground opacity-40 group-hover:opacity-100"
                                )}>
                                    {getSortIcon('name')}
                                </span>
                            </div>
                        </TableHead>
                        {data.data.timeRanges.map((timeRange, index) => (
                            <TableHead
                                key={timeRange}
                                className="min-w-[80px] cursor-pointer hover:bg-muted/50 transition-colors group"
                                onClick={() => handleHeaderClick(index)}
                            >
                                <div className="flex items-center">
                                    {timeRange}
                                    <span className={cn(
                                        "ml-1",
                                        sortField === index ? "text-foreground" : "text-muted-foreground opacity-40 group-hover:opacity-100"
                                    )}>
                                        {getSortIcon(index)}
                                    </span>
                                </div>
                            </TableHead>
                        ))}
                        <TableHead
                            className="min-w-[80px] cursor-pointer hover:bg-muted/50 transition-colors group bg-muted/30"
                            onClick={() => handleHeaderClick('total')}
                        >
                            <div className="flex items-center font-bold text-foreground">
                                {t('charts.ProductCookingTime.total')}
                                <span className={cn(
                                    "ml-1",
                                    sortField === 'total' ? "text-foreground" : "text-muted-foreground opacity-40 group-hover:opacity-100"
                                )}>
                                    {getSortIcon('total')}
                                </span>
                            </div>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {renderTableRows()}
                </TableBody>
                <TableFooter>
                    <TableRow>
                        <TableCell className="sticky left-0 bg-muted font-bold text-foreground">
                            {t('charts.ProductCookingTime.total')}
                        </TableCell>
                        {data.data.timeRanges.map((_, index) => {
                            const columnTotal = filteredAndSortedDishes.reduce(
                                (sum, dish) => sum + dish.values[index], 0
                            );
                            return (
                                <TableCell key={`total-${index}`} className="text-foreground">
                                    {columnTotal}
                                </TableCell>
                            );
                        })}
                        <TableCell className="font-bold bg-muted/30 text-foreground">
                            {filteredAndSortedDishes.reduce(
                                (sum, dish) => sum + (dish.total || 0), 0
                            )}
                        </TableCell>
                    </TableRow>
                </TableFooter>
            </Table>

            <div className="text-xs text-muted-foreground mt-2 flex items-center">
                <span className="mr-1">{t('charts.ProductCookingTime.sortHint')}</span>
                <span className="opacity-60">↕</span>
            </div>
        </div>
    );
});

CookingTimeTable.displayName = 'CookingTimeTable';

const SearchInput: React.FC<{
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    className?: string;
}> = React.memo(({ value, onChange, placeholder, className }) => {
    return (
        <div className={cn("relative flex-1 max-w-sm", className)}>
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="pl-8 pr-8"
            />
            {value && (
                <button
                    onClick={() => onChange("")}
                    className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground hover:text-foreground"
                    type="button"
                >
                    <X className="h-4 w-4" />
                </button>
            )}
        </div>
    );
});

SearchInput.displayName = 'SearchInput';

const ProductCookingTime = () => {
    const t = useTranslations("");
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
    const [showHeatmap, setShowHeatmap] = useState(true);
    const [perDishHeatmap, setPerDishHeatmap] = useState(true);

    const queryParams = React.useMemo(() => ({
        startDate: dayjs(startDate).format('YYYY-MM-DD'),
        endDate: dayjs(endDate).format('YYYY-MM-DD'),
        terminals: terminals?.toString(),
        organization: organization ?? undefined
    }), [startDate, endDate, terminals, organization]);

    const { data } = useSuspenseQuery<CookingTimeResponse>({
        queryKey: ["product-cooking-time", queryParams],
        queryFn: async () => {
            const response = await fetchProductCookingTime(
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

        const worker = new Worker(
            URL.createObjectURL(
                new Blob(
                    [
                        `
                        self.onmessage = function(e) {
                            const { dishes, timeRanges } = e.data;
                            
                            const headers = ['Dish Name', ...timeRanges, 'Total'];
                            const rows = dishes.map(dish => {
                                const total = dish.values.reduce((sum, value) => sum + value, 0);
                                return [dish.name, ...dish.values.map(v => v.toString()), total.toString()];
                            });
                            
                            const csvContent = [
                                headers.join(','),
                                ...rows.map(row => row.join(','))
                            ].join('\\n');
                            
                            self.postMessage(csvContent);
                        }
                        `
                    ],
                    { type: 'application/javascript' }
                )
            )
        );

        worker.onmessage = function (e) {
            const csvContent = e.data;
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `cooking-time-${dayjs().format('YYYY-MM-DD')}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            worker.terminate();
        };

        worker.postMessage({
            dishes: data.data.dishes,
            timeRanges: data.data.timeRanges
        });
    }, [data]);

    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
    const [debouncedModalSearchQuery, setDebouncedModalSearchQuery] = useState(modalSearchQuery);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedModalSearchQuery(modalSearchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [modalSearchQuery]);

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 mb-2 sm:flex-row">
                <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
                    <CardTitle>{t('charts.ProductCookingTime.title')}</CardTitle>
                    {selectedTerminal && (
                        <p className="text-sm text-muted-foreground mt-1">
                            {terminalsData?.data.find(terminal => terminal.id === selectedTerminal)?.name}
                        </p>
                    )}
                </div>
                {!terminals && (
                    <div className="flex">
                        <button
                            data-active={!organization || organization.length == 0}
                            className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t p-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0"
                            onClick={() => setOrganization("")}
                        >
                            <span className="text-lg font-bold leading-none">{t('charts.all')}</span>
                        </button>
                        {organizations.map((org) => {
                            return (
                                <button
                                    key={org.id}
                                    data-active={organization === org.id}
                                    className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t p-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0"
                                    onClick={() => setOrganization(org.id)}
                                >
                                    <span className="text-lg font-bold leading-none">
                                        {org.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </CardHeader>
            <CardContent>
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2">
                        <SearchInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder={t('charts.ProductCookingTime.searchPlaceholder')}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowHeatmap(!showHeatmap)}
                            className="whitespace-nowrap"
                        >
                            {showHeatmap
                                ? t('charts.ProductCookingTime.hideHeatmap')
                                : t('charts.ProductCookingTime.showHeatmap')}
                        </Button>
                        {showHeatmap && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPerDishHeatmap(!perDishHeatmap)}
                                className="whitespace-nowrap"
                            >
                                {perDishHeatmap
                                    ? t('charts.ProductCookingTime.globalHeatmap')
                                    : t('charts.ProductCookingTime.perDishHeatmap')}
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={exportToCSV}
                            className="whitespace-nowrap"
                        >
                            {t('charts.ProductCookingTime.exportCSV')}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setIsModalOpen(true)}
                            className="whitespace-nowrap"
                        >
                            {t('charts.ProductCookingTime.openFullTable')}
                        </Button>
                    </div>
                </div>

                <CookingTimeTable
                    data={data}
                    searchQuery={debouncedSearchQuery}
                    className="h-[200px]"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    showHeatmap={showHeatmap}
                    perDishHeatmap={perDishHeatmap}
                />

                <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                    <DialogContent className="max-w-[90vw]">
                        <DialogHeader>
                            <DialogTitle>{t('charts.ProductCookingTime.title')}</DialogTitle>
                            {selectedTerminal && (
                                <p className="text-sm text-muted-foreground mt-1">
                                    {terminalsData?.data.find(terminal => terminal.id === selectedTerminal)?.name}
                                </p>
                            )}
                            <p className="text-sm text-muted-foreground mt-1">
                                {dayjs(startDate).format('DD.MM.YYYY')} - {dayjs(endDate).format('DD.MM.YYYY')}
                            </p>
                        </DialogHeader>
                        <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center gap-2">
                                <SearchInput
                                    value={modalSearchQuery}
                                    onChange={setModalSearchQuery}
                                    placeholder={t('charts.ProductCookingTime.searchPlaceholder')}
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowHeatmap(!showHeatmap)}
                                >
                                    {showHeatmap
                                        ? t('charts.ProductCookingTime.hideHeatmap')
                                        : t('charts.ProductCookingTime.showHeatmap')}
                                </Button>
                                {showHeatmap && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPerDishHeatmap(!perDishHeatmap)}
                                    >
                                        {perDishHeatmap
                                            ? t('charts.ProductCookingTime.globalHeatmap')
                                            : t('charts.ProductCookingTime.perDishHeatmap')}
                                    </Button>
                                )}
                            </div>
                            <Button
                                variant="outline"
                                onClick={exportToCSV}
                            >
                                {t('charts.ProductCookingTime.exportCSV')}
                            </Button>
                        </div>
                        <CookingTimeTable
                            data={data}
                            searchQuery={debouncedModalSearchQuery}
                            className="max-h-[80vh]"
                            sortField={sortField}
                            sortDirection={sortDirection}
                            onSort={handleSort}
                            showHeatmap={showHeatmap}
                            perDishHeatmap={perDishHeatmap}
                        />
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    )
}
export default React.memo(ProductCookingTime);
