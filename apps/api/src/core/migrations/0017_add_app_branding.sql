-- 0017_add_app_branding.sql
--
-- Admin-editable app title (top bar), per language. Previously the literal
-- "Annur Apps" was hardcoded in the web app. Read publicly (the login page
-- shows it), written with appearance.manage; audited by SettingsService.set().

INSERT INTO system_settings (key, value) VALUES
    ('appearance.branding', '{"titleAr": "Annur Apps", "titleEn": "Annur Apps"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
