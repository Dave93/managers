// frontend/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { apiClient } from "./utils/eden";
import { routing } from "./i18n/routing";
import createMiddleware from "next-intl/middleware";

// Create the i18n middleware
const i18nMiddleware = createMiddleware(routing);

// Combined middleware
export async function middleware(request: NextRequest) {
    // First, handle the authentication check
    const sessionKey = request.cookies.get("sessionId")?.value;
    const refreshToken = request.cookies.get("refreshToken")?.value;
    console.log("sessionKey", sessionKey);
    console.log("refreshToken", refreshToken);
    const isLoginRoute = request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname.match(/^\/(en|ru|uz-Latn|uz-Cyrl)\/login$/) !== null;
    const isForbiddenRoute = request.nextUrl.pathname === '/forbidden' ||
        request.nextUrl.pathname.match(/^\/(en|ru|uz-Latn|uz-Cyrl)\/forbidden$/) !== null;

    // Skip auth check for login page and forbidden page
    if (isLoginRoute || isForbiddenRoute) {
        return i18nMiddleware(request);
    }

    // If no session, redirect to login
    if (!sessionKey) {
        const locale = ["en", "ru", "uz-Latn", "uz-Cyrl"].includes(request.nextUrl.pathname.split('/')[1])
        ? `/${request.nextUrl.pathname.split('/')[1]}`
        : '';
        return NextResponse.redirect(new URL(`${locale}/login`, request.url));
    }

    
    // Verify session with backend
    const { status } = await apiClient.api.users.me.get({
        headers: {
            Cookie: `sessionId=${sessionKey}; refreshToken=${refreshToken}`,
        },
    });

    console.log("status", status);

    if (status !== 200) {
        const locale = ["en", "ru", "uz-Latn", "uz-Cyrl"].includes(request.nextUrl.pathname.split('/')[1])
        ? `/${request.nextUrl.pathname.split('/')[1]}`
        : '';
        return NextResponse.redirect(new URL(`${locale}/login`, request.url));
    }

    // const { status: permissionsStatus, data: permissionsData } = await apiClient.api.users.permissions.get({
    //     headers: {
    //         Cookie: `session=${sessionKey}`,
    //     },
    // });

    // if (permissionsStatus !== 200) {
    //     return NextResponse.redirect(new URL(`/login`, request.url));
    // }

    // If authenticated, apply the intl middleware
    return i18nMiddleware(request);
}

export const config = {
    // Match all pathnames except for
    // - … if they start with `/api`, `/_next` or `/_vercel`
    // - … the ones containing a dot (e.g. `favicon.ico`)
    matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};