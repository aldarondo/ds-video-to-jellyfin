/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    // Allow .ts source imports with .js extension (for Node ESM compat in source)
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
