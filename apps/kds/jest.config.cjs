// Minimal node-side unit-test setup (lib helpers only — no React/DOM).
// Plain CJS on purpose: the production `next build` type-check must never see
// jest types (jest isn't installed in the scoped Docker build), so this file
// stays out of TypeScript's scope and tests compile via tsconfig.test.json.
/* eslint-disable no-undef -- CJS file; `module` is the CommonJS global */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
  moduleNameMapper: {
    // pos-core ships Node-ESM source with explicit .js specifiers, which this
    // CJS test run cannot resolve — same mapping apps/api's jest config uses.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@nuatis/pos-core$': '<rootDir>/../../packages/pos-core/src/index.ts',
    '^@nuatis/pos-web$': '<rootDir>/../../packages/pos-web/src/index.ts',
    '^@nuatis/pos-web/tickets$': '<rootDir>/../../packages/pos-web/src/tickets.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
}
