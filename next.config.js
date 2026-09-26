/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["*.trycloudflare.com"],
  eslint: { ignoreDuringBuilds: true },
  // Barcode scanning (src/components/BarcodeScanButton.tsx) calls
  // getUserMedia. Without an explicit Permissions-Policy some browsers deny
  // camera access outright in an installed-PWA / embedded context; `self`
  // allows it for this origin only. BarcodeDetector additionally requires a
  // secure context, which production (HTTPS via Cloudflare) and localhost
  // both satisfy.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Permissions-Policy", value: "camera=(self)" }] }];
  },
};

module.exports = nextConfig;

// Lets `next dev` (not just `wrangler dev`) see mocked Cloudflare bindings
// (Hyperdrive, R2, KV, Durable Objects) locally. Must be gated to dev only —
// calling it during `next build` bakes a dev-only dynamic require() into the
// production bundle, which crashes at runtime on Workers ("Dynamic require
// of .next/server/middleware-manifest.json is not supported").
if (process.env.NODE_ENV === "development") {
  const { initOpenNextCloudflareForDev } = require("@opennextjs/cloudflare");
  initOpenNextCloudflareForDev();
}
