// Header-line summary for the franchise-network ranking cards. Given the
// viewer's own rows (already filtered from the masked response) and the
// network total, produces:
//   - no own rows: "Нет привязанных филиалов"
//   - one own row: "Ваше место: 7 из 64"
//   - several own rows: "Chirchiq — 7, Depo — 31 из 64"
export function rankSummary(ownRows: { name: string; rank?: number }[], total: number): string | undefined {
  if (ownRows.length === 0) return "Нет привязанных филиалов";
  const sorted = [...ownRows].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  if (sorted.length === 1) {
    return `Ваше место: ${sorted[0].rank} из ${total}`;
  }
  const parts = sorted.map((r) => `${r.name} — ${r.rank}`).join(", ");
  return `${parts} из ${total}`;
}
