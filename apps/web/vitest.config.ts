import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

/**
 * Frontend unit/component layer (docs/TESTING_STRATEGY.md §1): Vitest +
 * React Testing Library. Merged onto the app's real vite.config.ts so tests
 * run through the same plugin pipeline (the React/JSX transform) as the
 * actual build, not a parallel hand-rolled setup.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      // `tests/**` is this project's OWN (core/platform) test tree.
      // Module-owned frontend tests (root DECISIONS.md D76) live at
      // `modules/<key>/test/frontend/*.test.{ts,tsx}` instead — kept out of
      // `apps/web/tests` so a module stays self-contained the same way its
      // `backend/`/`frontend/`/`locales/` already are.
      include: ['tests/**/*.test.{ts,tsx}', '../../modules/*/test/frontend/**/*.test.{ts,tsx}'],
      setupFiles: ['./tests/setup.ts'],
      css: true,
      restoreMocks: true,
    },
  }),
);
