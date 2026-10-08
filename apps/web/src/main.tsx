import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
// Bundled (offline-safe, OFL) rounded Arabic + Latin face used by the playful themes as the fallback behind any
// font a theme pack ships itself (e.g. Thmanyah, see themes/README.md).
import '@fontsource/baloo-bhaijaan-2/arabic-500.css';
import '@fontsource/baloo-bhaijaan-2/arabic-700.css';
import '@fontsource/baloo-bhaijaan-2/arabic-800.css';
import '@fontsource/baloo-bhaijaan-2/latin-500.css';
import '@fontsource/baloo-bhaijaan-2/latin-700.css';
import '@fontsource/baloo-bhaijaan-2/latin-800.css';

// Thmanyah Sans: bundled app asset (apps/web/src/assets/fonts/thmanyah/README.md, D101). Bundled by Vite, never served
// as separate files by the api. Themes opt in by naming it first in their font stacks.
import.meta.glob('./assets/fonts/thmanyah/thmanyah.css', { eager: true });

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element "#root" not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
