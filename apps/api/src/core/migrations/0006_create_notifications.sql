-- 0006_create_notifications.sql
--
-- Notification Center tables (docs/ARCHITECTURE.md §12, docs/BUILD_PLAN.md
-- Phase 4, docs/DECISIONS.md D20/D21/D22/D46).
--
-- notification_target_type is a real Postgres ENUM (not a CHECK on TEXT)
-- because Prisma enums map to native enum types — same lesson as 0000's
-- module_status and 0005's actor_type, same idempotent DO-block pattern.
--
-- FKs: notification_recipients cascades from BOTH parents — a deleted
-- notification takes its recipient rows with it, and a deleted user's
-- inbox rows are meaningless without the user (the *audit* trail of the
-- send lives in audit_log, which never cascades — see 0005). By contrast
-- notifications.sent_by and notifications.target_id carry NO FK: like
-- audit_log's actor columns, a sent notification must outlive the sender
-- (or the targeted role) it describes — the historical UUID is the record.
--
-- body_markdown stores Markdown SOURCE only — rendered to sanitized HTML at
-- send/display time, never stored pre-rendered (§12.1).
--
-- INSERT ... ON CONFLICT DO NOTHING keeps the seed sections idempotent SQL
-- in their own right (defense in depth), matching 0003/0004/0005's style.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_target_type') THEN
        CREATE TYPE notification_target_type AS ENUM ('user', 'role', 'all_users');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    category        TEXT NOT NULL,
    title           TEXT NOT NULL,
    body_markdown   TEXT NOT NULL,
    sent_by         UUID,                                   -- null = system-generated (§12.1)
    target_type     notification_target_type NOT NULL,
    target_id       UUID,                                   -- user_id or role_id; null for all_users
    CONSTRAINT notifications_all_users_has_no_target
        CHECK (target_type <> 'all_users' OR target_id IS NULL),
    CONSTRAINT notifications_narrow_target_has_id
        CHECK (target_type = 'all_users' OR target_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at);
CREATE INDEX IF NOT EXISTS notifications_category_idx ON notifications(category);

CREATE TABLE IF NOT EXISTS notification_recipients (
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at         TIMESTAMPTZ,
    emailed_at      TIMESTAMPTZ,
    PRIMARY KEY (notification_id, user_id)
);

-- The inbox query: "my rows, unread first" — user_id leading, read_at second.
CREATE INDEX IF NOT EXISTS notification_recipients_user_idx
    ON notification_recipients(user_id, read_at);

-- --- Seed: notification permission codes (D46 — this phase seeds its own) --
--
-- users.settings.view / users.settings.update were ALREADY seeded by
-- 0004_create_roles_permissions.sql (they were part of Phase 2's catalog even
-- though their enforcement point — the Settings endpoints — only arrives now,
-- in this phase). They are deliberately NOT re-listed here: 0004 owns them,
-- including their admin grant via its CROSS JOIN "admin gets everything"
-- seed. Only the three notifications.* codes are new.

INSERT INTO permissions (code, module_key, category, description_i18n_key) VALUES
    ('notifications.send',             'core', 'notifications', 'core.perm.notifications.send'),
    ('notifications.templates.manage', 'core', 'notifications', 'core.perm.notifications.templates.manage'),
    ('notifications.view',             'core', 'notifications', 'core.perm.notifications.view')
ON CONFLICT (code) DO NOTHING;

-- admin: all three (matching 0004/0005's grant style).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('notifications.send', 'notifications.templates.manage', 'notifications.view')
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

-- notifications.view goes to ALL FOUR base roles by default — everyone must
-- be able to see notices meant for them (ARCHITECTURE.md §12.4).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'notifications.view'
WHERE r.code IN ('library_assistant', 'finance', 'reader')
ON CONFLICT DO NOTHING;

-- --- Seed: default notification templates (D22 — admin-editable CONTENT) ---
--
-- One {subject, bodyMarkdown} pair per template, freeform Markdown, written
-- in whatever language the operator wants (per §12.3 these are NOT i18n
-- keys). Defaults are plain Arabic with a short English line; an admin
-- rewrites them freely from Settings -> Notification Templates.
--
-- {{name}} is substituted with the recipient's display name at send time
-- (the only placeholder the Phase 4 renderer supports — documented in
-- src/core/notifications/notifications.service.ts).

INSERT INTO system_settings (key, value) VALUES
    (
        'notifications.templates.password_reset',
        '{
            "subject": "تمت إعادة تعيين كلمة المرور الخاصة بك / Your password has been reset",
            "bodyMarkdown": "مرحباً {{name}}،\n\nقام مسؤول النظام بإعادة تعيين كلمة المرور الخاصة بحسابك. سيُطلب منك اختيار كلمة مرور جديدة عند تسجيل الدخول القادم.\n\nإذا لم تكن تتوقع هذا الإجراء، يرجى التواصل مع مسؤول النظام فوراً.\n\n---\n\nHello {{name}}, an administrator has reset your account password. You will be asked to choose a new password at your next login."
        }'::jsonb
    ),
    (
        'notifications.templates.force_password_change',
        '{
            "subject": "مطلوب تغيير كلمة المرور / Password change required",
            "bodyMarkdown": "مرحباً {{name}}،\n\nيتطلب حسابك تغيير كلمة المرور. عند تسجيل الدخول القادم سيُطلب منك تعيين كلمة مرور جديدة قبل متابعة استخدام النظام.\n\n---\n\nHello {{name}}, your account requires a password change. At your next login you will be asked to set a new password before continuing."
        }'::jsonb
    )
ON CONFLICT (key) DO NOTHING;

-- --- Seed: category -> channel config (admin-tunable, not a code constant) -
--
-- Which categories ALSO go out by email (every send always creates the
-- in-app notification_recipients rows regardless). Categories absent from
-- this map default to in-app only — see NotificationsService. Kept in
-- system_settings per the "every admin-tunable policy lives here" rule
-- (ARCHITECTURE.md §6.3), so an operator can flip a category to email
-- without a deploy.

INSERT INTO system_settings (key, value) VALUES
    (
        'notifications.categories',
        '{
            "auth.password_reset":        { "email": true },
            "auth.force_password_change": { "email": true },
            "system.announcement":        { "email": false }
        }'::jsonb
    )
ON CONFLICT (key) DO NOTHING;
