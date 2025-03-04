"use client";
import { ThemeProvider } from "@components/theme-provider";

export function NextUIProviders({ children }: { children: React.ReactNode }) {
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem>{children}</ThemeProvider>;
}
