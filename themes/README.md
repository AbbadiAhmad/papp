# Theme packs

A theme pack is a folder `themes/<key>/theme.json` — data only (colors, fonts,
corner radius, shell style), never code. Drop a folder in, then pick it under
**Appearance** in the app. No rebuild; the api reads the folder on demand.

To make a new theme: copy `template_theme/`, rename the folder, set the same
value as `"key"` inside (lowercase letters, digits, `_`), and edit the values.
Packs with a bad `theme.json` or a folder name that differs from `key` are
skipped and logged by the api. Schema: `packages/shared-types/src/appearance.ts`.

- `shell: "sidebar"` keeps the permanent side menu; `"tabs"` shows the menu
  groups as top tabs with the active group's pages in a second row.
- `dark` is optional; without it the theme is light-only.
- Fonts are plain font-family stacks. Nothing is downloaded from the internet
  (works offline); a font only applies if installed on the user's device.
- `headerImage` (optional) is a file name inside the theme folder (`svg`, `png`, `jpg`, `webp`), shown behind the top header under a tint of `headerBg`. Put the picture next to `theme.json`; wide, low-detail images work best (about 1600x96 for the header strip). Never a URL.

## Fonts

Themes name fonts in `fonts.ar` / `fonts.en` (plain stacks). The app bundles the
open-licensed rounded font **Baloo Bhaijaan 2** (Arabic + Latin) as a fallback,
so playful themes look right out of the box and offline.

Theme packs do **not** ship font files and the api never serves fonts. Thmanyah Sans is
bundled into the web build as an app asset (`apps/web/src/assets/fonts/thmanyah/`,
see its README for the license notice). `school_blue` names it first in its stacks;
any theme can do the same.

`"playful": true` turns on the child-friendly styling (big pill buttons, thicker
borders, soft shadows).
