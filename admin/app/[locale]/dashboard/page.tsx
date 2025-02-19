"use client";
import FilterPanel from "./filter-panel";
import ChartsPageClient from "./page.client";

export default function Dashboard() {
    return (
        <div className="p-4 space-y-6">
            <div className="sticky top-0 z-50">
                <FilterPanel />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <ChartsPageClient />
            </div>
        </div>
    );
}
