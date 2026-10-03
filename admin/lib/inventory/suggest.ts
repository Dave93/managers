// Подсказка филиала managers для магазина exord по названию (страница
// «Сопоставление exord»). Только подсказка — сохраняет человек.

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h",
};
const BRAND_WORDS = new Set(["chopar", "pizza", "les", "ailes", "sklad", "склад"]);

function words(name: string): string[] {
  const latin = name
    .toLowerCase()
    .split("")
    .map((c) => CYR[c] ?? c)
    .join("");
  return latin.split(/[^a-z0-9]+/).filter(Boolean);
}

function brand(name: string): "chopar" | "les" | null {
  const w = words(name);
  if (w.includes("chopar")) return "chopar";
  if (w.includes("les") || w.includes("ailes")) return "les";
  return null;
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const b = s.slice(i, i + 2);
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  return m;
}

// Коэффициент Дайса по биграммам названия без брендовых слов.
function similarity(a: string, b: string): number {
  const ka = words(a).filter((w) => !BRAND_WORDS.has(w)).join("");
  const kb = words(b).filter((w) => !BRAND_WORDS.has(w)).join("");
  if (ka.length < 2 || kb.length < 2) return 0;
  const ba = bigrams(ka);
  const bb = bigrams(kb);
  let overlap = 0;
  for (const [k, n] of ba) overlap += Math.min(n, bb.get(k) ?? 0);
  return (2 * overlap) / (ka.length - 1 + kb.length - 1);
}

export const SUGGEST_THRESHOLD = 0.6;

export function suggestTerminal<T extends { id: string; name: string }>(
  exordName: string,
  terminals: T[],
  taken: Set<string> = new Set()
): T | null {
  const b = brand(exordName);
  let best: T | null = null;
  let bestScore = 0;
  for (const t of terminals) {
    if (taken.has(t.id)) continue;
    if (b && brand(t.name) !== b) continue;
    const score = similarity(exordName, t.name);
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return bestScore >= SUGGEST_THRESHOLD ? best : null;
}
