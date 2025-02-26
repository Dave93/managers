// "use client";
import "./globals.css";
import React, { StrictMode } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import MainLayout from "@admin/components/layout/main-layout";
import SessionLocalProvider from "@admin/store/session-provider";
import { NextUIProviders } from "@admin/components/layout/providers";
import { NuqsAdapter } from 'nuqs/adapters/next/app';

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
            <SessionLocalProvider>
              <NuqsAdapter>
                <MainLayout>{children}</MainLayout>
              </NuqsAdapter>
            </SessionLocalProvider>
          </NextUIProviders>
        </StrictMode>
      </body>
    </html>
  );
}
