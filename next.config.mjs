import { readFileSync } from 'node:fs'

// The renderer is a static export with no access to package.json at runtime, so
// the version is stamped in here and read from the bundle.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: version },
  // Static export so Electron can serve the renderer from disk via the app:// protocol.
  output: 'export',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
