'use client';

import React from 'react';
import { routing, usePathname, useRouter } from '@admin/i18n/routing';
import { useLocale } from 'next-intl';
import { Button } from "@components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

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
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" className="capitalize flex items-center gap-1">
                    {languageNames[locale as keyof typeof languageNames]}
                    <ChevronDown className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                {routing.locales.map((localeOption) => (
                    <DropdownMenuItem
                        key={localeOption}
                        onClick={() => handleLanguageChange(localeOption)}
                    >
                        {languageNames[localeOption as keyof typeof languageNames]}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
} 