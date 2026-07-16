const MillionLint = require("@million/lint");

const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow Next.js dev server to accept requests from tunnel hosts (ngrok, etc.)
  // Without this, Next 15+ returns "NOT_FOUND" plain text for non-localhost
  // origins. Add specific subdomains via NEXT_DEV_ALLOWED_ORIGINS or extend
  // the array below.
  allowedDevOrigins: [
    "af97-146-120-16-63.ngrok-free.app",
    ".ngrok-free.app",
    ".ngrok.io",
    ".ngrok.app",
    ".loca.lt",
    ".trycloudflare.com",
  ],
  experimental: {
    // swcTraceProfiling: true,
    externalDir: true,
    // nodeMiddleware: true,  // not valid in canary 15.6.0-canary.57 (build emits warning)
    // reactCompiler: true,
    // swcPlugins: [
    //   [
    //     "next-superjson-plugin",
    //     {
    //       excluded: [],
    //     },
    //   ],
    // ],
  },
  env: {
    TRPC_API_URL: process.env.TRPC_API_URL,
    COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.TRPC_API_URL || "http://localhost:6761"}/api/:path*`,
      },
    ];
  },
};
// module.exports = MillionLint.next({ rsc: true })(nextConfig);
module.exports = withNextIntl(nextConfig);
