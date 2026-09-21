const baseConfig = require('./jest.config');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  displayName: 'e2e',
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  testPathIgnorePatterns: ['<rootDir>/test/unit/'],
  globalSetup: '<rootDir>/test/e2e/global-setup.ts',
  globalTeardown: '<rootDir>/test/e2e/global-teardown.ts',
  setupFiles: ['<rootDir>/test/support/load-e2e-env.ts'],
  maxWorkers: 1,
};
