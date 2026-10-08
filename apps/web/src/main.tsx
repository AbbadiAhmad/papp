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

// Thmanyah Sans: bundled into the build only if the owner dropped the licensed files in (local, gitignored; see the
// README in that folder). No files -> this glob is empty and the app uses the bundled open font instead.
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
