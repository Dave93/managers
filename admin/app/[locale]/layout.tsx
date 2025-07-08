import React from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

type Props = {
    children: React.ReactNode;
    params: Promise<{
        locale: string;
    }>;
};

export default async function LocaleLayout({ children, params }: Props) {
    const messages = await getMessages();
    const { locale } = await params;


    return (
        <>
            <NextIntlClientProvider
                locale={locale}
                messages={messages}
                timeZone={process.env.NEXT_PUBLIC_TIMEZONE}
                formats={{
                    dateTime: {
                        medium: {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                        },
                        long: {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: "2-digit",
                        },
                    },
                }}
            >
                {children}
            </NextIntlClientProvider>
        </>
    );
} 