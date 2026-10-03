"use client";
import { useEffect } from "react";
import { useRouter } from "@admin/i18n/routing";

// /passport has no page of its own — the curriculum builder is the section's
// home. Redirect client-side (this whole tree is client components, and the
// locale-aware router from i18n/routing keeps the /<locale> prefix that
// localePrefix:"always" requires) with replace(), so the empty /passport entry
// never lands in the back-button history.
export default function PassportIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/passport/curriculum");
  }, [router]);
  return <></>;
}
