# Thmanyah Sans (bundled app asset)

The five `woff2` weights (Light, Regular, Medium, Bold, Black) of **Thmanyah Sans**
are bundled into the web build through `thmanyah.css`, imported in `src/main.tsx`.
They are an app asset: packed and hashed by Vite, never served as separate
downloads by the api, and theme packs cannot ship fonts.

- Source: https://thmanyah.com. The repository owner downloaded the font and
  decided to include it as an asset (D101).
- License: thmanyah's Font License (copyright thmanyah Publishing and Distribution).
  It restricts redistribution and modification of the files. Do not edit, rename or
  convert them, do not publish them separately, and keep this notice. Questions:
  ask@thmanyah.com.
- Themes opt in by naming "Thmanyah Sans" first in `fonts.ar` / `fonts.en`
  (`themes/school_blue` does). The open font Baloo Bhaijaan 2 is the fallback.
