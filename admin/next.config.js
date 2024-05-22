const MillionLint = require("@million/lint");
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // swcTraceProfiling: true,
    externalDir: true,
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
  },
};
// module.exports = MillionLint.next({ rsc: true })(nextConfig);
module.exports = nextConfig;
