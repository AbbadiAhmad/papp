-- 0014_create_appearance.sql
--
-- Appearance (docs/DECISIONS.md D95/D96): installable theme packs
-- (`themes/<key>/theme.json`, data only) and an admin-editable menu layout.
-- No new tables: the active theme key and the menu layout live in
-- `system_settings`, so every change is audited by SettingsService.set().
--
--  - appearance.active_theme : JSONB string. 'default' = the built-in look.
--  - appearance.menu_layout  : JSONB {groups, hidden, labels}; empty = every
--    module's own manifest menu order, unchanged.
--
-- Reading the active theme and the layout needs no permission (the login page
-- and the sidebar render from them); changing them does.

INSERT INTO system_settings (key, value) VALUES
    ('appearance.active_theme', '"default"'::jsonb),
    ('appearance.menu_layout', '{"groups": [], "hidden": [], "labels": {}}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO permissions (code, module_key, category, description_i18n_key) VALUES
    ('appearance.view', 'core', 'appearance', 'core.perm.appearance.view'),
    ('appearance.manage', 'core', 'appearance', 'core.perm.appearance.manage')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('appearance.view', 'appearance.manage')
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;
