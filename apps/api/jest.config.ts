import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@nuatis/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts',
    '!src/**/scripts/**',
    '!src/voice/test-gemini.ts',
    '!src/lib/redis.ts', // infrastructure — tested via integration tests
    '!src/index.ts', // entry point — tested via smoke tests
  ],
  coverageThreshold: {
    global: {
      lines: 35,
      functions: 35,
      branches: 25,
      statements: 35,
    },
  },
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/lib/redis.test.ts',
    '<rootDir>/src/db/schema.test.ts',
    '<rootDir>/src/db/tenant-isolation.test.ts',
  ],
}

export default config
