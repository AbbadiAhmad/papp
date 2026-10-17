-- 0021_notification_confirmations.sql
--
-- Receipt / acceptance confirmation for notifications (docs/DECISIONS.md D119).
-- A notification can ask each emailed recipient to open a personal, unguessable
-- link and confirm. The confirmation is stored as EVIDENCE: who, when, from which
-- IP / browser, the exact text they were shown (plus its SHA-256), and the
-- optional comment. Reusable for policy / GDPR acceptance and, later, for
-- "accept the policy to activate the account" at registration.

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS requires_confirmation       BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS confirmation_type           TEXT,
    ADD COLUMN IF NOT EXISTS confirmation_allow_comment  BOOLEAN NOT NULL DEFAULT true;

-- Only the SHA-256 of the link token is stored; the token itself exists only
-- inside the email that was sent.
ALTER TABLE notification_recipients
    ADD COLUMN IF NOT EXISTS confirmation_token_hash   TEXT,
    ADD COLUMN IF NOT EXISTS confirmation_expires_at   TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS notification_recipients_confirmation_token_idx
    ON notification_recipients(confirmation_token_hash)
    WHERE confirmation_token_hash IS NOT NULL;

-- The evidence table. No foreign keys on purpose (like audit_log): evidence must
-- outlive the notification and the user it describes; it carries snapshots.
CREATE TABLE IF NOT EXISTS notification_confirmations (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id             UUID NOT NULL,
    user_id                     UUID NOT NULL,
    confirmation_type           TEXT NOT NULL,
    confirmed_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address                  TEXT,
    user_agent                  TEXT,
    method                      TEXT NOT NULL DEFAULT 'email_link',
    notification_title          TEXT NOT NULL,
    notification_body_markdown  TEXT NOT NULL,
    content_sha256              TEXT NOT NULL,
    confirmer_name              TEXT NOT NULL,
    confirmer_email             TEXT NOT NULL,
    comment                     TEXT,
    CONSTRAINT notification_confirmations_once UNIQUE (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS notification_confirmations_user_type_idx
    ON notification_confirmations(user_id, confirmation_type);
CREATE INDEX IF NOT EXISTS notification_confirmations_confirmed_at_idx
    ON notification_confirmations(confirmed_at);

-- Evidence is append-only: a row can never be changed or removed.
CREATE OR REPLACE FUNCTION notification_confirmations_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'notification_confirmations is append-only (evidence rows cannot be %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notification_confirmations_no_change ON notification_confirmations;
CREATE TRIGGER notification_confirmations_no_change
    BEFORE UPDATE OR DELETE ON notification_confirmations
    FOR EACH ROW EXECUTE FUNCTION notification_confirmations_immutable();

-- Permission to read the evidence (admin by default; grantable like any other).
INSERT INTO permissions (code, module_key, category, description_i18n_key) VALUES
    ('notifications.confirmations.view', 'core', 'notifications', 'core.perm.notifications.confirmations.view')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'notifications.confirmations.view'
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

-- Admin-tunable: how long an emailed confirmation link stays valid.
INSERT INTO system_settings (key, value) VALUES
    ('notifications.confirmation', '{ "linkTtlDays": 14 }'::jsonb)
ON CONFLICT (key) DO NOTHING;
