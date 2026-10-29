import { useTranslations } from "next-intl";

type Translate = (key: string) => string;

// Compact number with localized unit suffix (billion / million / thousand).
// `t` must be a translator scoped to the "charts" namespace.
export const compactWithUnits = (
  n: number,
  t: Translate,
  digits: [number, number, number],
  fallback: (n: number) => string
): string => {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(digits[0])} ${t("billion")}`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(digits[1])} ${t("million")}`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(digits[2])} ${t("thousand")}`;
  return fallback(n);
};

export const useCompactNumber = (digits: [number, number, number], fallback: (n: number) => string) => {
  const t = useTranslations("charts");
  return (n: number) => compactWithUnits(n, t, digits, fallback);
};
