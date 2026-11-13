import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Database-free runner for pure unit tests. The release suite remains vitest.config.ts. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/{invoices,payments,storage}.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
