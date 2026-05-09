/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The renderer scene is fully client-side; SSR doesn't render WebGL.
  // We still keep the route file structure under `app/` so that we can use
  // server components for layout, OG image generation, and future REST.
  experimental: {
    // Workspace packages are imported as TS source — Next 14 transpiles them.
    externalDir: true,
  },
  transpilePackages: ["@vtorn/spec", "@vtorn/spec-client"],
};

export default nextConfig;
