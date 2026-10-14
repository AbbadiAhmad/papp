-- 0016_add_landing_page_settings.sql
--
-- Admin-configurable default landing pages. JSON null = platform default
-- (anonymous visitors -> login page; logged-in users -> Welcome page).
-- A non-null value is a module route (see manifest frontend.landingPage /
-- frontend.publicLandingPage) and is ignored at read time if that module is
-- no longer installed, so uninstalling/deactivating a module silently
-- restores the platform default.

INSERT INTO system_settings (key, value) VALUES
    ('platform.landing.anonymous', 'null'::jsonb),
    ('platform.landing.authenticated', 'null'::jsonb)
ON CONFLICT (key) DO NOTHING;
