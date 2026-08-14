import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        // Pure logic: validation, rules, pure functions. No DB, no DOM.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        // React components.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./tests/setup/component.ts'],
        },
      },
      {
        // Service layer against a real local Postgres.
        // Requires `npm run db:start` first — see README.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['./tests/setup/integration.ts'],
          // Integration tests share one database; running them in parallel
          // would let them see each other's rows.
          fileParallelism: false,
        },
      },
    ],
  },
});
