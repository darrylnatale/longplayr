import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Disables ESLint rules that conflict with Prettier. Must stay last.
  prettier,
  {
    rules: {
      // A leading underscore marks a parameter that exists to satisfy a
      // signature rather than to be used. Server actions used with
      // `useActionState` must accept `(prevState, formData)` whether or not
      // they read either, and the default `after-used` behaviour only
      // tolerates that while some later parameter happens to be used.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // The service layer is the only place allowed to talk to the database.
      // See docs/architecture.md §4.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Clients only. The generated types are just types and are safe
              // to import anywhere.
              group: ['@/lib/supabase/server', '@/lib/supabase/client'],
              message:
                'Import database clients only from src/services/*. UI must not query directly — see docs/architecture.md §4.',
            },
          ],
        },
      ],
    },
  },
  {
    // The service layer and the Supabase helpers themselves are exempt.
    files: ['src/services/**', 'src/lib/supabase/**', 'src/proxy.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Every service-layer count goes through the counting boundary.
    // See docs/architecture.md §16.2.
    //
    // A `head: true` count is an HTTP HEAD request, and a HEAD response has no
    // body — so the client turns a 404 into a success-shaped result with a null
    // count, and `count ?? 0` reports a confident zero for a relation that could
    // not be resolved. Scoped to the service layer: tests assert against a
    // schema they control, where a silent zero fails the test rather than
    // misinforming a reader.
    files: ['src/services/**'],
    // Unit tests are colocated here, so the service-layer glob catches them.
    // They assert against fixtures they control, where a silent zero fails the
    // test rather than misinforming a reader — and the boundary's own test has
    // to be able to name what it is testing.
    ignores: ['src/services/**/*.test.ts', 'src/services/**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='head'][value.value=true]",
          message:
            'Do not write a raw `head: true` count. Use countRows(query, label) with COUNT_ONLY from @/services/count — see docs/architecture.md §16.2.',
        },
        {
          selector: "Property[key.value='head'][value.value=true]",
          message:
            'Do not write a raw `head: true` count. Use countRows(query, label) with COUNT_ONLY from @/services/count — see docs/architecture.md §16.2.',
        },
      ],
    },
  },
  {
    // The boundary itself. It defines COUNT_ONLY, so it holds the only
    // `head: true` in the service layer.
    files: ['src/services/count.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'supabase/**',
  ]),
]);

export default eslintConfig;
