# Reading Club module — documentation

Read `docs/MODULE_SPEC.md` §9 for what this file and `DECISIONS.md` are for and when to update them. Read `DECISIONS.md` in this same directory too — this file is the current shape, that one is why it's shaped that way.

## Purpose

Lets a librarian run one or more reading clubs: define groups made of ordered stages (each stage worth an amount of books OR pages), assign readers to a group, track how far each reader is from finishing their current stage, mark a stage finished (which grants a reward and advances the reader), and confirm the reward was physically delivered — including a hook on `library_circulation`'s own scan screen so a reward can be confirmed right when the reader is next physically present.

## Data model

```
reading_club_groups(id, name, description, is_active, created_at, updated_at, created_by -> users(id))

reading_club_stages(
  id, group_id -> reading_club_groups(id), stage_order, name,
  target_type CHECK(books|pages), target_amount, reward_description,
  UNIQUE(group_id, stage_order)
)

reading_club_memberships(              -- one active membership per reader (student_id UNIQUE)
  id, student_id -> library_students(id) UNIQUE, group_id -> reading_club_groups(id),
  current_stage_id -> reading_club_stages(id) NULL,
  stage_started_at, manual_progress_amount, assigned_by -> users(id), assigned_at, updated_at
)

reading_club_stage_completions(        -- append-only, never deleted
  id, student_id -> library_students(id), group_id, stage_id,
  target_amount_at_completion, progress_amount_at_completion,
  completed_at, marked_by -> users(id),
  reward_status CHECK(pending|delivered), reward_delivered_at, reward_delivered_by -> users(id)
)
```

- A "reader" is the same `library_students` row `library_circulation`'s scan screen already resolves (`dependsOn: ["library_circulation"]`) — this module never creates its own reader/student entity.
- `target_amount` on a stage is THAT STAGE'S OWN amount, not cumulative — "stage 1 = 5 books, stage 2 = an additional 10 books" is `target_amount` 5 then 10.
- Progress for a `books`-type stage is computed **live**, never stored: a count of `library_borrowings` with `status = 'returned' AND returned_at >= stage_started_at` for that reader, read directly off `library_circulation`'s own tables through this module's own `PrismaClient` — the same "a module reads its `dependsOn` dependency's tables directly, coupled only through the shared DB schema" pattern `library_circulation`'s own `CirculationService` already established for `library_catalog`. Progress for a `pages`-type stage has no such data source anywhere in the catalog, so it's the librarian's own manually-recorded `manual_progress_amount` — see `DECISIONS.md`.
- `reading_club_stage_completions` is append-only and never deleted — same "reading passport" permanence philosophy as `library_circulation` (`docs/LIBRARY_MODULE_REQUIREMENTS.md` §10). A group/stage can never be deleted once any reader has been assigned to it or completed a stage in it.
- Marking a stage complete (`StageCompletionsService.markComplete`) does TWO things in one transaction: creates the completion snapshot (`reward_status = 'pending'`) AND immediately advances the membership to the next stage (or to no stage at all, if it was the group's last one). Reward **delivery** is tracked independently via `confirmReward` — a librarian can hand over the actual present later without blocking the reader's progression.

## Permissions

| Code | Gates |
|---|---|
| `reading_club.groups.view` | List/view groups and their stages |
| `reading_club.groups.create` | Create a group |
| `reading_club.groups.update` | Edit a group, and create/edit its stages |
| `reading_club.groups.delete` | Delete a group or one of its stages |
| `reading_club.memberships.view` | View readers, their progress, and pending rewards |
| `reading_club.memberships.assign` | Assign a reader to a group, move them to another group, or manually move them to another stage |
| `reading_club.memberships.update_progress` | Record a reader's manual page-progress (pages-type stages only) |
| `reading_club.stage_completions.mark` | Mark a reader's current stage finished (grants the pending reward, advances the reader) |
| `reading_club.stage_completions.confirm_reward` | Confirm a reward was physically delivered — the same permission gates this action from BOTH this module's own reader page and `library_circulation`'s scan-page hook |
| `reading_club.dashboard.view` | `GET /dashboard` (groups/stages statistics) |

`defaultRolePermissions`: `admin` gets all 10. `library_assistant` (the platform's own mapping of "the librarian", per `docs/LIBRARY_MODULE_REQUIREMENTS.md` §1) also gets all 10 by default — the librarian requirement explicitly wants them defining groups/stages themselves, unlike `library_circulation`'s own `loan_policy` setting (admin/finance-only by default). `finance`/`reader` get none.

## Routes

Backend, all under `api/reading-club`, `MustChangePasswordGuard` + the global `JwtAuthGuard`/`PermissionGuard`:
- `GET/POST /groups`, `GET/PATCH/DELETE /groups/:id`, `GET/POST /groups/:groupId/stages`, `PATCH/DELETE /groups/stages/:stageId`
- `GET /readers`, `GET /readers/:studentId`, `POST /readers/assign`, `POST /readers/:studentId/move-stage`, `PUT /readers/:studentId/progress`
- `POST /readers/:studentId/complete-stage`, `GET /readers/:studentId/pending-rewards`, `POST /stage-completions/:completionId/confirm-reward`
- `GET /dashboard`

Frontend, all `access: "authenticated"` under `basePath: "/reading-club"` — no public routes:
- `/reading-club/dashboard` → `DashboardPage.tsx`
- `/reading-club/readers` → `ReadersListPage.tsx` (filters: `?groupId=`, `?stageId=`, free-text search)
- `/reading-club/readers/:studentId` → `ReaderDetailPage.tsx`
- `/reading-club/groups` → `GroupsListPage.tsx` (also where stages are managed, via `StagesManagerDialog`)

## Key files

- `backend/groups.service.ts` — group + stage CRUD, the dashboard aggregate query.
- `backend/memberships.service.ts` — reader search/filter/detail, assignment, manual stage moves, **`computeStageProgress`** (the books-vs-pages progress logic, see Data model above).
- `backend/stage-completions.service.ts` — `markComplete`/`confirmReward`/`listPendingRewards`; sends real in-app notifications on both events (never lets a notification failure fail the underlying action, same pattern as `library_circulation.CirculationService.notifyStudent`).
- `frontend/pages/StagesManagerDialog.tsx` — the actual "librarian defines the stages, the amount, the reward, the order" configuration surface (see `DECISIONS.md` for why this is plain CRUD, not the manifest `settings[]` mechanism).
- `frontend/circulationIntegration.ts` — a small, deliberately import-free (no static cross-module TS import) helper that lists `library_circulation`'s students for the "assign a reader" picker.
- `modules/library_circulation/frontend/readingClubIntegration.ts` (in the OTHER module) — the mirror-image helper for the scan-page hook; see that module's own `DOCUMENTATION.md`/`DECISIONS.md` too.

## Known gotchas / deliberate v1 scope cuts

- **No page-count data exists anywhere in the catalog** — `library_catalog_books` has no page-count column, so a `pages`-type stage's progress can never be computed automatically the way a `books`-type stage's can; it's the librarian's own manually-entered running total (`PUT /readers/:studentId/progress`). Don't silently "fix" this by inventing a page-count field on `library_catalog` from inside this module — that's a cross-module schema change belonging to `library_catalog` itself, raise it with the user first.
- **A reader belongs to exactly one group at a time** (`student_id` is UNIQUE on `reading_club_memberships`) — "moving" a reader to a different group is an upsert that overwrites the previous membership row, not a second row. Reward/completion HISTORY from the previous group is untouched (`reading_club_stage_completions` is keyed by student/group/stage independently, never cascaded).
- **No student-facing self-view** — every screen in this module needs staff-level permissions; a `reader`-role user cannot see their own reading-club progress today (not requested; the librarian's own requirements are staff-only). Raise it with the user before adding a self-service page.
- **No Excel import/export** for groups/stages/readers — not requested, and `library_circulation`'s own Excel import is itself still deferred (that module's `DOCUMENTATION.md`).
- **No reporting/analytics beyond the dashboard's stat cards** — no per-staff activity report, no time-filtered breakdowns (the dashboard shows live counts only, matching `library_circulation`'s own §18-vs-§19/20 scope cut).

## Migration application (root PLATFORM-GAP-001 — manual until the platform gains auto-discovery)

1. Apply the SQL: `psql $DATABASE_URL -f modules/reading_club/migrations/001_create_reading_club_tables.sql`
2. Register it so the install flow's checksum check doesn't try to re-run it:
   `INSERT INTO module_migrations (module_key, filename, checksum) VALUES ('reading_club', '001_create_reading_club_tables.sql', '37933b4b5f15c4d43a1315cf0deee36cacc94b34c0887a9dfbd59ca234a4dbc4');`
3. `npx prisma generate` (never `prisma migrate`) from `apps/api/` to pick up the already-hand-maintained `ReadingClubGroup`/`ReadingClubStage`/`ReadingClubMembership`/`ReadingClubStageCompletion` models in `schema.prisma`.

See `DECISIONS.md` READING_CLUB-D8/D9 for the full reasoning and how this was verified against a real (non-Docker) local Postgres instance.

## How to extend

Follow `docs/FEATURE_TEMPLATE.md` for any new endpoint (permission → guard → audit → locale keys in `ar`+`en` → tests). A new stage-configuration option (e.g. a due-by date per stage) starts in `CreateStageDto`/`UpdateStageDto` + the migration + `StagesManagerDialog.tsx`'s form. A new cross-module hook (this module reading from, or being read by, a THIRD module) should follow the same "raw `apiClient` endpoint call, never a static cross-module TS import" pattern this module and `library_circulation` already use both directions — see `DECISIONS.md`.
