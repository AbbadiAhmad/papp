-- 0005_create_audit_log.sql
--
-- Audit log table (docs/ARCHITECTURE.md §8.1, docs/BUILD_PLAN.md Phase 3,
-- docs/DECISIONS.md D13/D25/D46).
--
-- actor_type ships complete from day one ('user' | 'system' | 'anonymous')
-- even though 'anonymous' values cannot appear until Phase 5's @Public()
-- routes exist — per BUILD_PLAN.md Phase 3 ("not deferred to Phase 5").
-- Real Postgres ENUM type (not a CHECK on TEXT) because Prisma enums map to
-- native enum types — same lesson 0000 learned with module_status.
--
-- actor_user_id / actor_session_id deliberately carry NO foreign keys:
-- audit rows must outlive the user/session they describe (deleting a user
-- must never cascade into, block on, or null-out their audit trail — the
-- historical UUID is the record). The DB-level CHECK below enforces the
-- §8.1 invariant "actor_type = 'user' always has a non-null actor_user_id"
-- as defense in depth behind AuditInterceptor's own logic (BUILD_PLAN.md
-- risk #6).
--
-- INSERT ... ON CONFLICT DO NOTHING keeps the seed section idempotent SQL in
-- its own right (defense in depth), matching 0004's style.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'actor_type') THEN
        CREATE TYPE actor_type AS ENUM ('user', 'system', 'anonymous');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS audit_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_user_id       UUID,
    actor_session_id    UUID,
    actor_type          actor_type NOT NULL,
    category            TEXT NOT NULL,
    entity_type         TEXT NOT NULL,
    entity_id           TEXT,
    action              TEXT NOT NULL,
    old_value           JSONB,
    new_value           JSONB,
    ip_address          TEXT,
    user_agent          TEXT,
    CONSTRAINT audit_log_user_actor_has_user_id
        CHECK (actor_type <> 'user' OR actor_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx ON audit_log(occurred_at);
CREATE INDEX IF NOT EXISTS audit_log_category_idx ON audit_log(category);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_user_id_idx ON audit_log(actor_user_id);

-- --- Seed: audit permission codes (D46 — this phase seeds its own) ----------
--
-- Granted to admin by default (matching 0004's grant style); other roles get
-- nothing — an admin can grant audit.view from the Permissions page later.

INSERT INTO permissions (code, module_key, category, description_i18n_key) VALUES
    ('audit.view',  'core', 'audit', 'core.perm.audit.view'),
    ('audit.purge', 'core', 'audit', 'core.perm.audit.purge')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('audit.view', 'audit.purge')
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;
