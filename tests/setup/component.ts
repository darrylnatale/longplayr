import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

/**
 * **Unmounts between tests, which does not happen on its own here.**
 *
 * `@testing-library/react` registers its own `afterEach(cleanup)` only when a
 * global `afterEach` exists, and this project does not set Vitest's
 * `globals: true`. Without it every `render` accumulates in the same document,
 * and the second test in a file fails with "Found multiple elements" against
 * markup that is perfectly correct.
 *
 * **Never noticed before because the `component` project had no files.** It was
 * configured in Phase 0 and matched nothing until 2026-10-03 — see F-062.
 */
afterEach(cleanup);
