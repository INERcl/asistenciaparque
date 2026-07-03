import withSerwistInit from "@serwist/next";

// Serwist genera el service worker desde app/sw.ts hacia public/sw.js.
// El precache del app-shell permite arranque offline (PWA).
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // En desarrollo el SW se deshabilita para no cachear entre recargas.
  disable: process.env.NODE_ENV === "development",
  // Precachea el documento "/" en el install del SW: la app arranca offline
  // aunque el HTML nunca haya quedado en el runtime cache (ver fallback en sw.ts).
  additionalPrecacheEntries: [{ url: "/", revision: `${Date.now()}` }],
});

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withSerwist(nextConfig);
