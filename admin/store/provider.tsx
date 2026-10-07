"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function Providers({ children }: { children: React.ReactNode }) {
  // useState с инициализатором, а не `new QueryClient()` в теле компонента:
  // тот создавал бы новый клиент на каждый рендер и выбрасывал весь кэш
  // запросов вместе с ним.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
