// Header-line summary for the franchise-network ranking cards. Given the
// viewer's own rows (already filtered from the masked response) and the
// network total, produces:
//   - no own rows, brand selected: "В этом бренде ваших филиалов нет"
//   - no own rows, no brand selected: "Нет привязанных филиалов"
//   - one own row: "Ваше место: 7 из 64"
//   - several own rows: "Chirchiq — 7, Depo — 31 из 64"
// `t` is a translator scoped to "dashboardUi.rankSummary".
export function rankSummary(
  ownRows: { name: string; rank?: number }[],
  total: number,
  opts: { brandSelected?: boolean } | undefined,
  t: (key: string, values?: Record<string, string | number>) => string
): string | undefined {
  if (ownRows.length === 0) {
    return opts?.brandSelected ? t("noOwnInBrand") : t("noOwnBranches");
  }
  const sorted = [...ownRows].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  if (sorted.length === 1) {
    return t("ownPlace", { rank: sorted[0].rank ?? 0, total });
  }
  const parts = sorted.map((r) => `${r.name} — ${r.rank}`).join(", ");
  return t("ownPartsOfTotal", { parts, total });
}
