/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    externalDir: true,
    // better-sqlite3 has native bindings; webpack must NOT try to
    // bundle it. The standard escape hatch in App Router is the
    // serverComponentsExternalPackages list (Next 14).
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

export default nextConfig;
