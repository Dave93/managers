import { Button } from "@admin/components/ui/button";
import Link from "next/link";
import { signOut } from "next-auth/react";

export default function NoRoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-fuchsia-800 h-[100dvh] flex items-center justify-around w-full">
      <div className="flex flex-col text-center">
        <h3 className="font-bold text-[10rem] text-white">403</h3>
        <h4 className="font-bold text-4xl uppercase">
          У Вас не достаточно прав для доступа к этой странице, пожалуйста
          обратитесь к администратору
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
