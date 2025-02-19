
export const intervals = (t: any) => [
    { value: "1 day", label: t('charts.intervals.1_day') },
    { value: "1 week", label: t('charts.intervals.1_week') },
    { value: "1 month", label: t('charts.intervals.1_month') },
];

export const formatDate = (date: string, interval: string) => {
    const d = new Date(date);
    switch (interval) {
        case "1 day":
            return d.toLocaleDateString();
        case "1 week":
            return `Week ${getWeekNumber(d)} of ${d.getFullYear()}`;
        case "1 month":
            return d.toLocaleDateString("default", {
                month: "short",
                year: "numeric",
            });
        default:
            return d.toLocaleDateString();
    }
};

export const getWeekNumber = (d: Date) => {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};