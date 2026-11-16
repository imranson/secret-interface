import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // PGlite (the embedded database used when DATABASE_URL is unset) loads its WebAssembly files from its own folder.
  serverExternalPackages: ['@electric-sql/pglite'],
  experimental: {
    // Turbopack's on-disk build cache records env values (incl. OLLAMA_API_KEY), which trips Netlify's secrets scanner.
    turbopackFileSystemCacheForBuild: false,
  },
}

export default nextConfig
