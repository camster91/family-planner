module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Component tests are .test.tsx and opt into jsdom with a @jest-environment docblock.
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts', '<rootDir>/src/**/__tests__/**/*.test.tsx'],
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'src/lib/auth.ts',
    'src/lib/gamification.ts',
    'src/lib/validations.ts',
  ],
};
