-- 001_create_survey_tables.sql
--
-- survey module — Google-Forms-style survey builder with conditional
-- show/hide logic, public/login-required sharing, editable answers, and a
-- dynamic pivot report. Table names prefixed `survey_` (MODULE_SPEC.md §5's
-- collision-avoidance convention, mirrors library_catalog's own prefixing).
--
-- No permission/role seeding here — a real installable module registers its
-- `permissions`/`defaultRolePermissions` through ModuleRegistryService at
-- install time from manifest.json (MODULE_SPEC.md §4 step 4), exactly like
-- library_catalog. This migration only creates this module's own tables.
--
-- survey_responses is the one deliberately absent thing here: there is no
-- "draft"/partial-response table anywhere in this schema. The user's
-- explicit requirement ("if the session is over or the user did not
-- complete the survey it should not be stored in the system") is satisfied
-- by construction — the frontend never calls a write endpoint until the
-- respondent submits the complete, final answer set (see
-- modules/survey/frontend/pages/TakeSurveyPage.tsx's own docblock). There is
-- nothing to sweep/expire because nothing partial is ever written.

-- Real Postgres ENUM types (not a CHECK on TEXT) because Prisma enums map to
-- native enum types — same lesson core's own 0000/0005/0006 migrations
-- already learned (see apps/api/src/core/migrations/0005_create_audit_log.sql's
-- own comment).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'survey_status') THEN
        CREATE TYPE survey_status AS ENUM ('draft', 'published', 'closed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'survey_question_type') THEN
        CREATE TYPE survey_question_type AS ENUM (
            'short_text', 'paragraph', 'single_choice', 'multi_choice',
            'dropdown', 'linear_scale', 'date', 'time', 'rating'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'survey_logic_action') THEN
        CREATE TYPE survey_logic_action AS ENUM ('show', 'hide');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'survey_logic_target_type') THEN
        CREATE TYPE survey_logic_target_type AS ENUM ('section', 'question');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS survey_surveys (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title                       TEXT NOT NULL,
    description                 TEXT,
    status                      survey_status NOT NULL DEFAULT 'draft',
    owner_user_id               UUID NOT NULL REFERENCES users(id),
    requires_login              BOOLEAN NOT NULL DEFAULT false,
    allow_edit_after_submit     BOOLEAN NOT NULL DEFAULT false,
    -- Enforced in ResponsesService.submitAuthenticated ONLY — meaningful
    -- exclusively for a KNOWN respondent (a logged-in user); a no-op for an
    -- anonymous one, since anonymity and deduplication are fundamentally in
    -- tension (a real, honestly-scoped limitation, not silently pretended to
    -- work), documented in docs/DECISIONS.md. Not a DB constraint (see
    -- survey_responses_respondent_idx below) since it is a per-survey,
    -- admin-toggleable setting, not a global invariant.
    one_response_per_respondent BOOLEAN NOT NULL DEFAULT true,
    notify_owner_on_submit      BOOLEAN NOT NULL DEFAULT true,
    -- Arbitrary admin-typed addresses, NOT platform user accounts (the
    -- module-owned exception to D21 confirmed with the user — see
    -- docs/DECISIONS.md). Stored as a JSON array of strings rather than a
    -- Postgres TEXT[] so Prisma's JSON type maps it without a native-array
    -- special case (matches SystemSetting.value's own jsonb convention).
    notify_emails               JSONB NOT NULL DEFAULT '[]'::jsonb,
    opens_at                    TIMESTAMPTZ,
    closes_at                   TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS survey_surveys_owner_idx ON survey_surveys (owner_user_id);
CREATE INDEX IF NOT EXISTS survey_surveys_status_idx ON survey_surveys (status);

CREATE TABLE IF NOT EXISTS survey_sections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id   UUID NOT NULL REFERENCES survey_surveys(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT
);

CREATE INDEX IF NOT EXISTS survey_sections_survey_idx ON survey_sections (survey_id);

CREATE TABLE IF NOT EXISTS survey_questions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id  UUID NOT NULL REFERENCES survey_sections(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL,
    -- v1 core set (confirmed with the user — file upload and question grids
    -- are explicitly deferred to a fast-follow, not built here).
    type        survey_question_type NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    required    BOOLEAN NOT NULL DEFAULT false,
    -- Type-specific shape, e.g. linear_scale: {"min":1,"max":5,"minLabel":"...","maxLabel":"..."},
    -- rating: {"max":5}. Never interpreted by raw SQL — only by
    -- modules/survey/backend/logic-engine.ts and the question-rendering components,
    -- both of which validate the shape for the question's own declared type.
    config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS survey_questions_section_idx ON survey_questions (section_id);

-- Options for the three enumeration question types (single_choice,
-- multi_choice, dropdown) — these are exactly the "enumeration answers" the
-- conditional-logic engine branches on.
CREATE TABLE IF NOT EXISTS survey_question_options (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL,
    -- Stable machine value the logic engine and stored answers reference —
    -- never renamed once real responses exist (renaming the *label* is
    -- always safe; renaming `value` would silently break existing answers'
    -- meaning and any live logic rules pointing at it).
    value       TEXT NOT NULL,
    label       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS survey_question_options_question_idx ON survey_question_options (question_id);
CREATE UNIQUE INDEX IF NOT EXISTS survey_question_options_unique_value_idx ON survey_question_options (question_id, value);

-- The conditional show/hide engine (docs/DECISIONS.md records the exact
-- visibility semantics: a target with zero rules is always visible; a
-- target with any rule is hidden by default and shown only by a currently-
-- matching `show` rule, with a matching `hide` rule always winning over a
-- `show` rule for the same target).
CREATE TABLE IF NOT EXISTS survey_logic_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id           UUID NOT NULL REFERENCES survey_surveys(id) ON DELETE CASCADE,
    source_question_id  UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
    -- Must match one of source_question_id's own option values — validated
    -- at structure-save time (PUT .../structure), not by a DB-level FK
    -- (options can be reordered/replaced within the same save transaction,
    -- making a literal FK to survey_question_options impractical).
    source_option_value TEXT NOT NULL,
    action              survey_logic_action NOT NULL,
    target_type         survey_logic_target_type NOT NULL,
    target_id           UUID NOT NULL,
    order_index         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS survey_logic_rules_survey_idx ON survey_logic_rules (survey_id);
CREATE INDEX IF NOT EXISTS survey_logic_rules_source_question_idx ON survey_logic_rules (source_question_id);
CREATE INDEX IF NOT EXISTS survey_logic_rules_target_idx ON survey_logic_rules (target_type, target_id);

-- One row per FINAL submission only — see this file's header comment for
-- why there is deliberately no draft/partial-response table.
CREATE TABLE IF NOT EXISTS survey_responses (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id          UUID NOT NULL REFERENCES survey_surveys(id) ON DELETE CASCADE,
    -- Captured whenever the respondent has a real session, REGARDLESS of the
    -- survey's own requires_login setting (being logged in is always a safe
    -- superset — see docs/DECISIONS.md for the full endpoint-split
    -- rationale). Null for a genuinely anonymous respondent.
    respondent_user_id UUID REFERENCES users(id),
    respondent_email   TEXT,
    -- Only set for an anonymous response whose survey allows post-submit
    -- editing (allow_edit_after_submit = true AND respondent_user_id IS
    -- NULL) — a random secret returned ONCE at submit time, hashed here the
    -- same way a refresh token is (@Sensitive, never logged/audited in the
    -- clear).
    edit_token_hash    TEXT,
    submitted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address         TEXT,
    user_agent         TEXT
);

CREATE INDEX IF NOT EXISTS survey_responses_survey_idx ON survey_responses (survey_id);

-- NOT a unique index: "one response per respondent" is a PER-SURVEY,
-- admin-toggleable setting (survey_surveys.one_response_per_respondent),
-- not a global invariant — a plain/partial index can't be made conditional
-- on a column in another table without a trigger, which this scope doesn't
-- warrant. Enforced instead in ResponsesService.submitAuthenticated (the
-- only path that can even identify "the same respondent twice" — an
-- anonymous respondent, with no login, is never deduplicated). This index
-- stays as a plain (non-unique) one purely for the lookup ResponsesService
-- already does on every authenticated submit.
CREATE INDEX IF NOT EXISTS survey_responses_respondent_idx ON survey_responses (survey_id, respondent_user_id);

-- One row per question per response — deliberately relational (not a single
-- JSON blob per response) specifically so the dynamic pivot report can
-- GROUP BY question_id/value directly in SQL, and so a structure edit that
-- removes a question doesn't corrupt every other question's data in the
-- same response.
CREATE TABLE IF NOT EXISTS survey_answers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id UUID NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
    -- Shape depends on the question's type: string (short_text/paragraph/
    -- dropdown/single_choice/date/time), string[] (multi_choice), or number
    -- (linear_scale/rating).
    value       JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS survey_answers_response_idx ON survey_answers (response_id);
CREATE INDEX IF NOT EXISTS survey_answers_question_idx ON survey_answers (question_id);
CREATE UNIQUE INDEX IF NOT EXISTS survey_answers_unique_question_idx ON survey_answers (response_id, question_id);
