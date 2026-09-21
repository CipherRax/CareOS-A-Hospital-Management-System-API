/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': '@swc/jest',
  },
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/$1',
  },
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  testPathIgnorePatterns: ['<rootDir>/test/e2e/'],
  testEnvironment: 'node',
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/worker.ts',
    '!src/**/*.module.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: false,
};
