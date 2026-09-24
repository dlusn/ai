import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    // The fixtures import the package by name, the way a consumer repo does.
    alias: [
      { find: '@dlusn/ai/speech', replacement: src('speech/index.ts') },
      { find: '@dlusn/ai/stub', replacement: src('stub.ts') },
      { find: '@dlusn/ai/pricing', replacement: src('pricing.ts') },
      { find: /^@dlusn\/ai$/, replacement: src('index.ts') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
