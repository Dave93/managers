import { Suspense } from "react";

// Страницы заявок читают фильтры из URL (nuqs → useSearchParams): без границы Suspense
// `next build` падает на пререндере («should be wrapped in a suspense boundary»).
export default function TicketsLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}
