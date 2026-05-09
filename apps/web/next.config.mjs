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
  transpilePackages: ["@vtorn/spec", "@vtorn/spec-client", "@vtorn/avatar"],
  webpack: (config) => {
    // ESM-style imports inside the @vtorn/* workspace packages use `.js`
    // suffixes (NodeNext convention). The actual files are `.ts` / `.tsx`,
    // so teach webpack to resolve `.js` imports to those source files.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
