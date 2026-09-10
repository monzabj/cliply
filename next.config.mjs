/** @type {import('next').NextConfig} */
const nextConfig = {
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
