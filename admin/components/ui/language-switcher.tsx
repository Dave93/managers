'use client';

import React from 'react';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button } from "@nextui-org/react";
import { routing, usePathname, useRouter } from '@admin/i18n/routing';
import { useLocale } from 'next-intl';

const languageNames = {
    'en': 'English',
    'ru': 'Русский',
    'uz-Latn': 'O\'zbekcha',
    'uz-Cyrl': 'Ўзбекча'
};

export default function LanguageSwitcher() {
    const router = useRouter();
    const pathname = usePathname();
    const locale = useLocale();

    const handleLanguageChange = (locale: string) => {
        router.push(pathname, { locale });
    };

    return (
        <Dropdown>
            <DropdownTrigger>
                <Button
                    variant="bordered"
                    className="capitalize"
                >
                    {languageNames[locale as keyof typeof languageNames]}
                </Button>
            </DropdownTrigger>
            <DropdownMenu
                aria-label="Language selection"
                onAction={(key) => handleLanguageChange(key as string)}
            >
                {routing.locales.map((locale) => (
                    <DropdownItem key={locale}>
                        {languageNames[locale as keyof typeof languageNames]}
                    </DropdownItem>
                ))}
            </DropdownMenu>
        </Dropdown>
    );
} 