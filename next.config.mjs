/** @type {import('next').NextConfig} */
const nextConfig = {
  // Overridable so a test/CI build can use its own directory instead of
  // fighting a running dev server over .next
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
