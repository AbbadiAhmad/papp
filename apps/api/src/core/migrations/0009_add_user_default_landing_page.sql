-- 0009_add_user_default_landing_page.sql
--
-- Feature: per-user default landing page (the route the user is sent to
-- right after login, instead of the hardcoded core DashboardPage). NULL
-- means "platform default" (today's behavior, unchanged). Stores a route
-- path string — validated against the platform default plus every
-- currently-installed module's own `frontend.landingPage` at write time
-- (users.service.ts), never trusted as an arbitrary path.

ALTER TABLE users ADD COLUMN IF NOT EXISTS default_landing_page TEXT;
