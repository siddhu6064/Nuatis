import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',

  // Transpile shared package from monorepo
  transpilePackages: ['@nuatis/shared'],

  // Turbopack: resolve .js imports to .ts source in shared package
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
}

export default config
