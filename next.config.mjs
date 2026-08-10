/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ['tien-len-local.com', '*.trycloudflare.com'],
};

export default nextConfig;