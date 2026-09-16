// Extends Vitest's `expect` with the jest-dom matchers (toBeInTheDocument(),
// etc.) used across the frontend component test suite.
import '@testing-library/jest-dom/vitest';

// `vitest.config.ts` does not set `test.globals: true` (this suite always
// imports `describe`/`it`/`expect`/... explicitly from 'vitest', matching
// the existing App.test.tsx convention), so @testing-library/react's
// auto-cleanup — which only self-registers when it detects Jest/Vitest
// globals on `globalThis` — never kicks in on its own. Without this, a
// component rendered by one `it()` stays mounted into the next, and any
// later query in the same file that matches more than one instance throws
// a "Found multiple elements" error. Register it explicitly instead.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
