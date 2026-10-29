module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Component tests are .test.tsx and opt into jsdom with a @jest-environment docblock.
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts', '<rootDir>/src/**/__tests__/**/*.test.tsx'],
  modulePathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/.open-next/', '<rootDir>/.wrangler/', '<rootDir>/src/generated/cloudflare-read/'],
  moduleNameMapper: {
    '\\.module\\.css$': '<rootDir>/src/__tests__/helpers/css-module.js',
    // Keep Jest on its CommonJS test boundary. The production OpenNext
    // package is ESM-only and is loaded by the Worker runtime, not Node's
    // ts-jest runner.
    '^@opennextjs/cloudflare$': '<rootDir>/src/__tests__/helpers/opennext-cloudflare.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.browser-setup.js'],
  collectCoverageFrom: [
    'src/lib/auth.ts',
    'src/lib/gamification.ts',
    'src/lib/validations.ts',
  ],
};
