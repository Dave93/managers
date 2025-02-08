const MillionLint = require("@million/lint");

const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin();
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // swcTraceProfiling: true,
    externalDir: true,
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
};
// module.exports = MillionLint.next({ rsc: true })(nextConfig);
module.exports = withNextIntl(nextConfig);
