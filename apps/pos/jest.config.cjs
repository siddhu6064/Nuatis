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
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
}
