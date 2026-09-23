import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    // Integration tests share one Postgres database, so run files one at a time.
    fileParallelism: false,
  },
});
