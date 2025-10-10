import React, { StrictMode } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@admin/i18n/routing";
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
    params: Promise<{
        locale: string;
    }>;
};

export function generateStaticParams() {
    return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: Props) {
    const { locale } = await params;

    // Ensure that the incoming `locale` is valid
    if (!hasLocale(routing.locales, locale)) {
        notFound();
    }

    // Enable static rendering
    setRequestLocale(locale);

    const messages = await getMessages();

    return (
        <html lang={locale} suppressHydrationWarning>
            <body className={inter.className}>
                <StrictMode>
                    <NextUIProviders>
                        <NuqsAdapter>
                            <Providers>
                                <NextIntlClientProvider messages={messages}>
                                    <MainLayout>{children}</MainLayout>
                                </NextIntlClientProvider>
                            </Providers>
                        </NuqsAdapter>
                    </NextUIProviders>
                </StrictMode>
            </body>
        </html>
    );
} 