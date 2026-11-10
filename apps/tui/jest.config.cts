/* eslint-disable */
// Plain jest config (no nx preset/resolver): the resolver's tsconfig
// fallback mis-resolves two-level relative imports from src/__tests__
// under jest 30 in this workspace; the default resolver is exact.
const { readFileSync } = require('fs');

const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@prism/tui',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  // @prism/* packages resolve straight to their TypeScript sources.
  moduleNameMapper: {
    '^@prism/agent$': '<rootDir>/../../libs/agent/src/index.ts',
    '^@prism/ai-core$': '<rootDir>/../../libs/ai-core/src/index.ts',
    '^@prism/llm$': '<rootDir>/../../libs/llm/src/index.ts',
    '^@prism/shared-types$': '<rootDir>/../../libs/shared-types/src/index.ts',
    '^@prism/web-search$': '<rootDir>/../../libs/web-search/src/index.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/src/lib/**/*.spec.ts'],
  coverageDirectory: 'test-output/jest/coverage',
};
