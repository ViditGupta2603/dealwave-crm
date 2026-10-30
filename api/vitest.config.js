import { defineConfig } from 'vitest/config';
import { testEnv } from './test/env.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    globalSetup: ['test/globalSetup.js'],
    env: testEnv(),
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
