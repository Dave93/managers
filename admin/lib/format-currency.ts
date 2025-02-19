export const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("ru-RU", {
        currency: "UZS",
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
    }).format(value);
}