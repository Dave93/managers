"use client";
import { Card } from "@components/ui/card";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@components/ui/navigation-menu";
import Link from "next/link";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex">
      <div className="w-2/12 mr-6">
        <Card>
          <NavigationMenu orientation="vertical">
            <NavigationMenuList className="flex-col">
              <NavigationMenuItem>
                <NavigationMenuLink asChild>
                  <Link href="/settings" className={navigationMenuTriggerStyle()}>
                    Основные
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink asChild>
                  <Link href="/settings/iiko" className={navigationMenuTriggerStyle()}>
                    Iiko
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </Card>
      </div>
      <div className="w-full">
        <Card className="px-6 py-2 pt-6">{children}</Card>
      </div>
    </div>
  );
}
