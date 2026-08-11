/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ['tien-len-local.com', '*.trycloudflare.com'],

  async headers() {
    return [
      {
        // Next marks prerendered pages `s-maxage=31536000`, and a CDN in front
        // of the app takes that literally: after a deploy it keeps serving the
        // old HTML, which references content-hashed chunks that no longer
        // exist, and the app dies on load with ChunkLoadError. Make documents
        // revalidate every time. Files under /_next/static are excluded — their
        // names contain a content hash, so caching those forever is correct and
        // is what makes repeat visits fast.
        source: '/((?!_next/static|_next/image).*)',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;