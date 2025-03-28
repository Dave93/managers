"use client";

import { Button } from "@admin/components/ui/buttonOrigin";
import { signOut } from "next-auth/react";

export default function Profile() {
  return (
    <div className="container">
      <div className="fixed bottom-20 w-full left-0 px-4">
        <Button className="w-full" onClick={() => signOut({
          callbackUrl: '/login'
        })}>
          Log out
        </Button>
      </div>
    </div>
  );
}
