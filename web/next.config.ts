import type { NextConfig } from 'next';

const basePath =
  process.env.NEOWEB_BASE_PATH ??
  (process.env.GITHUB_REPOSITORY
    ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}`
    : '');
const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
