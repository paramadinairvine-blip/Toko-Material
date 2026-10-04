module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  globalSetup: '<rootDir>/tests/helpers/globalSetup.js',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
    '!src/lib/prisma.js',
    '!src/utils/logger.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 20,
      functions: 30,
      lines: 45,
      statements: 45,
    },
  },
  forceExit: true,
  detectOpenHandles: true,
};
