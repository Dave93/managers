export type GradableQuestion = {
  id: string;
  type: "single" | "multi";
  correctOptionIds: string[];
};

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

export function gradeAnswer(q: GradableQuestion, selected: string[]): boolean {
  if (!selected || selected.length === 0) return false;
  return sameSet([...new Set(selected)], [...new Set(q.correctOptionIds)]);
}

export function gradeAttempt(
  questions: GradableQuestion[],
  answers: Record<string, string[]>
): { score: number; correctCount: number } {
  if (questions.length === 0) return { score: 0, correctCount: 0 };
  let correctCount = 0;
  for (const q of questions) {
    if (gradeAnswer(q, answers[q.id] ?? [])) correctCount++;
  }
  return {
    score: Math.round((correctCount / questions.length) * 100),
    correctCount,
  };
}

export function shuffleWithRng<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function pickQuestionIds(
  allIds: string[],
  n: number | null,
  rng: () => number
): string[] {
  const shuffled = shuffleWithRng(allIds, rng);
  if (n == null || n >= shuffled.length) return shuffled;
  return shuffled.slice(0, n);
}
