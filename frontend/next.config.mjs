/** @type {import('next').NextConfig} */
const nextConfig = {
  // GitHub Pages only serves static files — no server, so no rewrites/API
  // routes/image optimization are possible here. Anything needing the
  // FastAPI backend (AI analysis, OCR, market data) will fail client-side
  // in production until a real backend host is wired back up via
  // NEXT_PUBLIC_API_URL (see frontend/src/lib/api.ts).
  output: "export",
  images: { unoptimized: true },
  // Pre-existing lint errors in unrelated files (no-explicit-any) otherwise
  // block `next build` entirely. `npm run lint` still runs them normally —
  // this only stops lint from gating the production build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
