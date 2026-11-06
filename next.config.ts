import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Turbopack's on-disk build cache records env values (incl. OLLAMA_API_KEY), which trips Netlify's secrets scanner.
    turbopackFileSystemCacheForBuild: false,
  },
}

export default nextConfig
