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
