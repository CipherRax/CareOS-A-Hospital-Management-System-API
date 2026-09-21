const baseConfig = require('./jest.config');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  displayName: 'unit',
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  testPathIgnorePatterns: ['<rootDir>/test/e2e/'],
};
