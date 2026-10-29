import { Button } from "@admin/components/ui/buttonOrigin";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

export default function NoRoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("layoutUi.noRole");
  return (
    <div className="bg-fuchsia-800 h-[100dvh] flex items-center justify-around w-full">
      <div className="flex flex-col text-center">
        <h3 className="font-bold text-[10rem] text-white">403</h3>
        <h4 className="font-bold text-4xl uppercase">
          {t("message")}
        </h4>
        <div className="space-x-3 mt-6">
          <Link href="/">
            <Button size="lg" className="uppercase font-bold">
              Go home
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
            Logout
          </Button>
        </div>
      </div>
    </div>
  );
}
