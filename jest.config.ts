import type { Config } from 'jest';

const config: Config = {
  rootDir: 'src',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          resolvePackageJsonExports: false,
        },
      },
    ],
  },
  setupFiles: ['<rootDir>/test-setup.ts'],
  // Prisma's generated client uses ESM-style ".js" specifiers that resolve to
  // ".ts" on disk; Jest's resolver takes them literally without this.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  collectCoverageFrom: ['**/*.(t|j)s', '!generated/**'],
  coverageDirectory: '../coverage',
};

export default config;
