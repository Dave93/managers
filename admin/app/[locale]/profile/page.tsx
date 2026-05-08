"use client";

import { Button } from "@admin/components/ui/buttonOrigin";
import { useAuth } from "@admin/components/useAuth";

export default function Profile() {
  const { signOut } = useAuth();
  return (
    <div className="container">
      <div className="fixed bottom-20 w-full left-0 px-4">
        <Button className="w-full" onClick={() => signOut()}>
          Log out
        </Button>
      </div>
    </div>
  );
}
