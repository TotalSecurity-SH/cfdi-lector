import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // La herramienta se publica bajo /cfdi para integrarse al hub (Next.js multi-zones).
  basePath: "/cfdi",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    // Si alguien abre el dominio de Vercel directo (sin /cfdi), lo mandamos a la herramienta.
    return [{ source: "/", destination: "/cfdi", basePath: false, permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
