import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@nuatis/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@nuatis/pos-core$': '<rootDir>/../../packages/pos-core/src/index.ts',
    '^@nuatis/pos-web$': '<rootDir>/../../packages/pos-web/src/index.ts',
  },
  // These packages' tests live outside rootDir (apps/api), so the default
  // testMatch would never discover them and they would appear to have no tests.
  roots: [
    '<rootDir>/src',
    '<rootDir>/../../packages/pos-core/src',
    '<rootDir>/../../packages/pos-web/src',
  ],
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
  // Jest's 5000ms default is a unit-test budget, and this is an
  // integration-heavy suite that runs in parallel. Measured under a
  // 48-worker run on 8 cores: 23 tests take over 1s and five take over 3s —
  // not because they hang, but because they do real work. The rate-limit
  // test alone makes 101 sequential HTTP round trips to prove a cap of 100.
  //
  // At 5000ms those sit within scheduling jitter of the deadline, and under
  // load the unluckiest one fails with "Exceeded timeout of 5000 ms" — seen
  // on billing.test.ts and sso.test.ts. index.test.ts and
  // voice-pipeline.integration already set their own higher values and still
  // do (a per-file jest.setTimeout overrides this); those two were this same
  // problem being patched one file at a time.
  //
  // This does NOT fix the separate intermittent "socket hang up" failures,
  // which are an ECONNRESET from the ephemeral supertest server and happen
  // well inside this deadline — admin-console.integration hit one in 5.4s
  // against a 30s timeout. See docs for what has been ruled out.
  testTimeout: 30_000,
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/lib/redis.test.ts',
    '<rootDir>/src/db/schema.test.ts',
    '<rootDir>/src/db/tenant-isolation.test.ts',
  ],
}

export default config
