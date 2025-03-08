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


const ErrorFallback = ({ error }: { error: Error }) => (
    <div className="text-red-500 p-4 bg-red-100 rounded-lg">
        <p className="font-bold">Something went wrong:</p>
        <pre className="mt-2 text-sm">{error.message}</pre>
    </div>
);

const ChartWrapper = ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <div className={cn("h-[400px]", className)}>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
            <Suspense fallback={<LoadingAnimation />}>{children}</Suspense>
        </ErrorBoundary>
    </div>
);


export default function ChartsPageClient() {
    return (
        <>
            <ChartWrapper className="col-span-2">
                <RevenueChart />
            </ChartWrapper>
            <ChartWrapper className="col-span-2">
                <RevenueByBranches />
            </ChartWrapper>
            <ChartWrapper className="col-span-2">
                <OrderCountChart />
            </ChartWrapper>
            <ChartWrapper className="col-span-2">
                <OrderCountByBranches />
            </ChartWrapper>
            <ChartWrapper className="col-span-2">
                <AverageCheckChart />
            </ChartWrapper>
            <ChartWrapper className="col-span-2">
                <OrderHourlyHeatmapChart />
            </ChartWrapper>
            <ChartWrapper className="col-span-2">
                <OrderDistributionChart />
            </ChartWrapper>
            <ChartWrapper className="col-span-2">
                <OrderAmountHourlyHeatmapChart />
            </ChartWrapper>

            <ChartWrapper className="col-span-2">
                <PopularDishesChart />
            </ChartWrapper>
            <ChartWrapper className="col-span-2">
                <PopularDishesByPrice />
            </ChartWrapper>
            <ChartWrapper className="col-span-4 h-[600px]">
                <ProductCookingTime />
            </ChartWrapper>
            <ChartWrapper className="col-span-2 h-[600px]">
                <BasketAdditionalSales />
            </ChartWrapper>
            <ChartWrapper className="col-span-2">
                <BasketAdditionalSalesBySource />
            </ChartWrapper>
            <ChartWrapper className="col-span-4 h-[600px]">
                <BasketAdditionalSalesBySourceGroup />
            </ChartWrapper>
            <ChartWrapper className="col-span-4">
                <BasketAdditionalSalesTrendChart />
            </ChartWrapper>
        </>
    )
}