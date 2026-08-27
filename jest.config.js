module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { esModuleInterop: true } }] },
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns: ['main.ts', '\\.module\\.ts'],
  testEnvironment: 'node',
};
