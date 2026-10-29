import { Button } from "@admin/components/ui/buttonOrigin";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

import LanguageSwitcher from "@admin/components/ui/language-switcher";
export default function NoRoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("layoutUi.noRole");
  return (
    <div className="relative bg-fuchsia-800 h-[100dvh] flex items-center justify-around w-full">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <div className="flex flex-col text-center">
        <h3 className="font-bold text-[10rem] text-white">403</h3>
        <h4 className="font-bold text-4xl uppercase">
          {t("message")}
        </h4>
        <div className="space-x-3 mt-6">
          <Link href="/">
            <Button size="lg" className="uppercase font-bold">
              {t("goHome")}
            </Button>
          </Link>
          <Button
            size="lg"
            className="uppercase font-bold"
            onClick={() =>
              signOut({
                callbackUrl: "/api/auth/signin",
              })
            }
          >
            {t("logout")}
          </Button>
        </div>
      </div>
    </div>
  );
}
