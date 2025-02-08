import { NextRequestWithAuth, withAuth } from "next-auth/middleware";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@admin/i18n/routing";
import { LocalePrefixMode } from "next-intl/dist/types/src/routing/types";

const publicPages = ['/login'];
const routesWithoutPermission = ["profile"];

// Create the i18n middleware
const i18nMiddleware = createMiddleware({
  ...routing,
  localePrefix: "always" as LocalePrefixMode
});

export default async function middleware(request: NextRequestWithAuth, event: NextFetchEvent) {
  const pathname = request.nextUrl.pathname;

  // Handle i18n first
  const i18nResponse = await i18nMiddleware(request);
  if (i18nResponse) return i18nResponse;

  // Then handle auth
  return withAuth(
    function middleware(req: NextRequestWithAuth) {
      const token = req.nextauth.token;
      if (!token) {
        return NextResponse.redirect(new URL("/api/auth/signin", req.url));
      }

      const publicPathnameRegex = RegExp(
        `^(/(${routing.locales.join('|')}))?(${publicPages
          .flatMap((p) => (p === '/' ? ['', '/'] : p))
          .join('|')})/?$`,
        'i'
      );
      const isPublicPage = publicPathnameRegex.test(req.nextUrl.pathname);
      if (isPublicPage) {
        return NextResponse.next();
      }

      const path = req.nextUrl.pathname.split("/");
      let entity = path[path.length - 1];

      if (path[1] == "settings") {
        entity = "settings";
      }

      if (path[1] == "reports") {
        entity = "reports";
      }

      if (routesWithoutPermission.includes(entity)) {
        return NextResponse.next();
      }

      if (entity.length > 0 && token.rights) {
        const rights = token.rights as string[];
        if (!rights.includes(`${entity}.list`)) {
          return NextResponse.redirect(new URL("/forbidden", req.url));
        }
      }

      return NextResponse.next();
    },
    {
      callbacks: {
        authorized: ({ token }) => {
          if (!token) return false;
          if (!token.role) return false;
          return true;
        },
      },
      pages: {
        signIn: '/login'
      }
    }
  )(request, event);
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)', '/', '/(ru|en|uz-Latn|uz-Cyrl)/:path*']
};
