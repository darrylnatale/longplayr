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
          // `scripts/` is build tooling rather than app code, and had no tests
          // at all until the pre-push migration warning needed one — a guard
          // whose wording, left stale, causes the outage it exists to prevent
          // (`architecture.md` §11.1). `.mts` because the scripts are ESM and
          // `tsconfig.json` already includes that extension.
          include: ['src/**/*.test.ts', 'scripts/**/*.test.mts'],
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
          // Timeouts stay at Vitest's 5s default here, deliberately. Measured
          // over a clean run, 231 of 234 tests finish inside a second and the
          // slowest takes 2.25s, so 5s is ample and keeps a tight budget on the
          // 87 tests that never touch auth — the ones best placed to notice a
          // query getting slower.
          //
          // The files that create real auth users raise their own limit, in the
          // file, for a reason recorded there.
        },
      },
      {
        // Seeding utilities, not tests. A separate project so they never run
        // as part of the suite — the integration tests truncate the catalogue
        // between cases and would wipe anything seeded here.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'seed',
          environment: 'node',
          include: ['tests/seed/**/*.ts'],
          // NOT the integration setup: that one refuses remote databases
          // because those tests truncate tables. Seeding targets staging on
          // purpose. See tests/setup/seed.ts.
          setupFiles: ['./tests/setup/seed.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
