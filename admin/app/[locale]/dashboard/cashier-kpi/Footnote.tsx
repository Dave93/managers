import { useTranslations } from "next-intl";

// Shared one-liner: every cashier-KPI card carries this caveat once, since
// an iiko login is an account, not necessarily one person.
const Footnote = () => {
  const t = useTranslations("dashboardUi.cashierKpi");
  return <p className="text-[11px] text-muted-foreground">{t("footnote")}</p>;
};

export default Footnote;
