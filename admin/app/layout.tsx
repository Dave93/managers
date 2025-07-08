// "use client";
import "./globals.css";
import React, { StrictMode } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import MainLayout from "@admin/components/layout/main-layout";
import { NextUIProviders } from "@admin/components/layout/providers";
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Providers } from "@admin/store/provider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Admin",
  description: "Admin",
};

type Props = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: Props) {
  return (
    <html suppressHydrationWarning>
      <body className={inter.className}>
        <StrictMode>
          <NextUIProviders>
            <NuqsAdapter>
              <Providers>
                <MainLayout>{children}</MainLayout>
              </Providers>
            </NuqsAdapter>
          </NextUIProviders>
        </StrictMode>
      </body>
    </html>
  );
}
