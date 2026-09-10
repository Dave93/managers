'use client'

import useToken from "@admin/store/get-token"
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import AverageCheckChart from "./AverageCheckChart";
import LoadingAnimation from "./LoadingAnimation";
// import OrderAmountHourlyHeatmapChart from "./OrderAmountHourlyHeatmapChart";
// import OrderCountChart from "./OrderCountChart";
// import OrderDistributionChart from "./OrderDistributionChart";
// import RevenueChart from "./RevenueChart";
// import OrderHourlyHeatmapChart from "./OrderHourlyHeatmapChart";
// import PopularDishesChart from "./PopularDishesChart";
// import PopularDishesByPrice from "./PopularDishesByPrice";
// import RevenueByBranches from "./RevenueByBranches";
// import OrderCountByBranches from "./OrderCountByBranches";
import { cn } from "@admin/lib/utils";
import { useIsMobile } from "@admin/utils/use-is-mobile";
import MobileDashboard from "./_mobile/MobileDashboard";
import RevenueChart from "./RevenueChart";
import RevenueByBranches from "./RevenueByBranches";
import OrderCountChart from "./OrderCountChart";
import OrderCountByBranches from "./OrderCountByBranches";
import OrderHourlyHeatmapChart from "./OrderHourlyHeatmapChart";
import OrderDistributionChart from "./OrderDistributionChart";
import OrderAmountHourlyHeatmapChart from "./OrderAmountHourlyHeatmapChart";
import PopularDishesChart from "./PopularDishesChart";
import PopularDishesByPrice from "./PopularDishesByPrice";
import ProductCookingTime from "./ProductCookingTime";
import BasketAdditionalSales from "./BasketAdditionalSales";
import BasketAdditionalSalesBySource from "./BasketAdditionalSalesBySource";
import BasketAdditionalSalesBySourceGroup from "./BasketAdditionalSalesBySourceGroup";
import BasketAdditionalSalesTrendChart from "./BasketAdditionalSalesTrendChart";
import StoplistByDay from "./StoplistByDay";
import CashShiftsByDay from "./CashShiftsByDay";


const ErrorFallback = ({ error }: { error: Error }) => (
    <div className="text-red-500 p-4 bg-red-100 rounded-lg">
        <p className="font-bold">Something went wrong:</p>
        <pre className="mt-2 text-sm">{error.message}</pre>
    </div>
);

const ChartWrapper = ({ children, className }: { children: React.ReactNode, className?: string }) => (
    // min-w-0 lets the grid/flex track shrink below the chart's intrinsic width
    // (default min-width:auto otherwise forces the column wider than a phone
    // viewport → horizontal overflow). Charts (recharts/nivo) are responsive and
    // fill the resulting width; wide tables scroll via their own container.
    <div className={cn("min-w-0 h-[360px] md:h-[400px]", className)}>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
            <Suspense fallback={<LoadingAnimation />}>{children}</Suspense>
        </ErrorBoundary>
    </div>
);


export default function ChartsPageClient() {
    const isMobile = useIsMobile();

    if (isMobile) {
        return <MobileDashboard />;
    }

    return (
        <>
            <ChartWrapper className="md:col-span-2">
                <RevenueChart />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2">
                <RevenueByBranches />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2">
                <OrderCountChart />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2">
                <OrderCountByBranches />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2">
                <AverageCheckChart />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2">
                <OrderHourlyHeatmapChart />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2">
                <OrderDistributionChart />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2">
                <OrderAmountHourlyHeatmapChart />
            </ChartWrapper>

            <ChartWrapper className="md:col-span-2">
                <PopularDishesChart />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2">
                <PopularDishesByPrice />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2 lg:col-span-4 h-[480px] md:h-[600px]">
                <ProductCookingTime />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2 h-[520px] md:h-[650px]">
                <BasketAdditionalSales />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2">
                <BasketAdditionalSalesBySource />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2 lg:col-span-4 h-[480px] md:h-[600px]">
                <BasketAdditionalSalesBySourceGroup />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2 lg:col-span-4">
                <BasketAdditionalSalesTrendChart />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2 lg:col-span-4 h-[480px] md:h-[600px]">
                <StoplistByDay />
            </ChartWrapper>
            <ChartWrapper className="md:col-span-2 lg:col-span-4 h-[560px] md:h-[680px]">
                <CashShiftsByDay />
            </ChartWrapper>
        </>
    )
}