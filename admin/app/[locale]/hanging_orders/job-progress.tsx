"use client";

import { Loader2 } from "lucide-react";

export type JobProgress = { title: string; text: string };

/**
 * Заметная панель хода фоновой задачи (сверка, массовая отмена) — поверх
 * страницы, сверху по центру: задача идёт минутами, и маленький тост в углу
 * легко пропустить, к тому же он обрезал текст. fixed, а не sticky: у корня
 * страницы overflow-x-hidden, с ним sticky не прилипает.
 */
export function JobProgressBanner({ progress }: { progress: JobProgress | null }) {
    if (!progress) return null;

    // «день 18 из 122», «обработано 52 из 154» — первая пара даёт полосу.
    const m = progress.text.match(/(\d+)\s+из\s+(\d+)/);
    const done = m ? Number(m[1]) : null;
    const total = m ? Number(m[2]) : null;
    const pct = done !== null && total ? Math.min(100, Math.round((done / total) * 100)) : null;

    return (
        <div
            role="status"
            aria-live="polite"
            className="fixed left-1/2 top-4 z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border-2 border-blue-500 bg-blue-50 px-5 py-4 shadow-2xl dark:border-blue-400 dark:bg-blue-950"
        >
            <div className="flex items-center gap-3">
                <Loader2 className="h-6 w-6 shrink-0 animate-spin text-blue-600 dark:text-blue-300" />
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-4">
                        <p className="text-base font-semibold text-blue-900 dark:text-blue-100">
                            {progress.title}
                        </p>
                        {pct !== null && (
                            <span className="shrink-0 text-lg font-bold tabular-nums text-blue-900 dark:text-blue-100">
                                {pct}%
                            </span>
                        )}
                    </div>
                    <p className="mt-0.5 break-words text-sm text-blue-800 dark:text-blue-200">
                        {progress.text}
                    </p>
                </div>
            </div>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
                <div
                    className={
                        pct !== null
                            ? "h-full rounded-full bg-blue-600 transition-all duration-500 dark:bg-blue-400"
                            : "h-full w-1/3 animate-pulse rounded-full bg-blue-600 dark:bg-blue-400"
                    }
                    style={pct !== null ? { width: `${pct}%` } : undefined}
                />
            </div>
            <p className="mt-2 text-xs text-blue-700 dark:text-blue-300">
                Страницу можно не держать открытой — задача идёт на сервере.
            </p>
        </div>
    );
}
