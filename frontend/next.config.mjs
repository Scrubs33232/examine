/** @type {import('next').NextConfig} */
const nextConfig = {
  // In production (set BACKEND_ORIGIN in Vercel), same-origin /api/* calls
  // from the browser are transparently forwarded to the FastAPI backend —
  // no CORS, no second DNS record for the main app. This does NOT apply to
  // the copy-trader control API: that one stays on NEXT_PUBLIC_COPYTRADER_API_URL
  // (localhost only, see copyTraderApi.ts) since it executes real trades
  // unauthenticated and must never be reachable over the public internet.
  async rewrites() {
    const backendOrigin = process.env.BACKEND_ORIGIN;
    if (!backendOrigin) return [];
    return [{ source: "/api/:path*", destination: `${backendOrigin}/api/:path*` }];
  },
};

export default nextConfig;
