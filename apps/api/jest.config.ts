import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@nuatis/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@nuatis/pos-core$': '<rootDir>/../../packages/pos-core/src/index.ts',
  },
  // pos-core's tests live outside rootDir (apps/api), so the default testMatch
  // would never discover them and the package would appear to have no tests.
  roots: ['<rootDir>/src', '<rootDir>/../../packages/pos-core/src'],
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
