-- 0018_default_theme_classic_library.sql
--
-- Classic Library (docs/DECISIONS.md D109) becomes the default look for installs
-- whose theme was never chosen by a person: still the seeded 'default' or the
-- 0015 'school_blue', AND no user-made change to the setting in the audit log
-- (actor_type 'user'). An admin's own choice, including a deliberate
-- 'school_blue', is never overwritten. If the pack folder is missing the api
-- falls back to the built-in look anyway.

UPDATE system_settings
SET value = '"classic_library"'::jsonb
WHERE key = 'appearance.active_theme'
  AND value IN ('"default"'::jsonb, '"school_blue"'::jsonb)
  AND NOT EXISTS (
    SELECT 1 FROM audit_log
    WHERE entity_type = 'SystemSetting'
      AND entity_id = 'appearance.active_theme'
      AND actor_type = 'user'
  );
