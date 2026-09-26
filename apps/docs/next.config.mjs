import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
export default withMDX({
  output: 'export',
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  images: { unoptimized: true },
  reactStrictMode: true,
  // Resolve both this app and the local chart package from the workspace root.
  turbopack: { root: new URL('../..', import.meta.url).pathname },
  transpilePackages: ['@bloxwap/chart'],
});
