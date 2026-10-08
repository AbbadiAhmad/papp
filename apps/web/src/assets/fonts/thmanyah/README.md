# Thmanyah Sans (local only, never committed)

The Thmanyah font license forbids uploading or hosting the font files where
others can download them, and allows web use only inside a compiled/packaged
product. So the files are **not in git** and are **never served as files** by
the api. They are bundled into the web build (Vite) when present.

To use it on a machine or deployment:

1. Download the font from https://thmanyah.com (agree to its license).
2. Copy these `woff2` files from `thmanyah typeface/thmanyahsans/woff2/` into this folder:
   `thmanyahsans-Light.woff2`, `-Regular`, `-Medium`, `-Bold`, `-Black`.
3. Copy `thmanyah.css.example` to `thmanyah.css`.
4. Rebuild the web app (`npm run build --workspace=@papp/web`, or `docker compose build web`).

Without these files the app shows the bundled open font (Baloo Bhaijaan 2) instead.
Questions about licensing: ask@thmanyah.com.
