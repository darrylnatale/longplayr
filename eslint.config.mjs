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
