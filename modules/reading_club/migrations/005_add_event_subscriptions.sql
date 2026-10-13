-- 005_add_event_subscriptions.sql
--
-- reading_club module — per-user opt-in subscriptions to club events
-- (reader added/removed/moved, stage completed, reward given, group/stage
-- changes, episodes). A subscriber is any user holding
-- `reading_club.notifications.subscribe`; delivery goes through core's
-- Notification Center (in-app). See READING_CLUB-D20.
--
-- One row per (user, event). `event_type` is TEXT validated in the service
-- against a fixed list, not a CHECK, so a new event type needs no migration.

CREATE TABLE IF NOT EXISTS reading_club_event_subscriptions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_reading_club_event_subscriptions_event_type
    ON reading_club_event_subscriptions (event_type);
