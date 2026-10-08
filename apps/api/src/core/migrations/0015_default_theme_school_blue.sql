-- 0015_default_theme_school_blue.sql
--
-- Restyle (docs/DECISIONS.md D97): School Blue becomes the active theme for
-- installs still on the untouched built-in default. An admin's own choice is
-- never overwritten (only the seeded value 'default' is replaced), and if the
-- pack folder is ever missing the api falls back to the built-in look anyway.

UPDATE system_settings
SET value = '"school_blue"'::jsonb
WHERE key = 'appearance.active_theme' AND value = '"default"'::jsonb;
