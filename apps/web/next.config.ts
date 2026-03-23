import type { NextConfig } from 'next'

const config: NextConfig = {
  // Transpile shared package from monorepo
  transpilePackages: ['@nuatis/shared'],
}

export default config
