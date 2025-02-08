'use client';
import { useSession } from "next-auth/react";
import { redirect, usePathname } from "next/navigation";
import { useEffect } from "react";

export default function LoginRedirect() {
    // const pathname = usePathname();
    // const { data: session } = useSession();

    // useEffect(() => {
    //     if (!session && !pathname.includes('/login')) {
    //         return redirect('/login');
    //     }
    // }, [session, pathname]);

    return <></>
}