# Reading Club module — documentation

Read `docs/MODULE_SPEC.md` §9 for what this file and `DECISIONS.md` are for and when to update them. Read `DECISIONS.md` in this same directory too — this file is the current shape, that one is why it's shaped that way.

## Purpose

Lets a librarian run one or more reading clubs: define groups made of ordered stages (each stage worth an amount of books OR pages), assign readers to a group, track how far each reader is from finishing their current stage, mark a stage finished (which grants a reward and advances the reader), and confirm the reward was physically delivered — including a hook on `library_circulation`'s own scan screen so a reward can be confirmed right when the reader is next physically present.

## Data model

```
reading_club_episodes(
  id, name, is_current BOOLEAN, starts_at, ends_at NULL, created_by -> users(id), created_at
  -- at most one is_current=true row, via a partial unique index (READING_CLUB-D10)
)

reading_club_groups(id, episode_id -> reading_club_episodes(id), name, description, is_active, created_at, updated_at, created_by -> users(id))

reading_club_stages(
  id, group_id -> reading_club_groups(id), stage_order, name,
  target_type CHECK(books|pages), target_amount, reward_description,
  UNIQUE(group_id, stage_order)
  -- NO episode_id of its own — inherits its episode from group_id (READING_CLUB-D10)
)

reading_club_memberships(              -- one active membership per reader (student_id UNIQUE)
  id, student_id -> library_students(id) UNIQUE, episode_id -> reading_club_episodes(id),
  group_id -> reading_club_groups(id), current_stage_id -> reading_club_stages(id) NULL,
  stage_started_at, manual_progress_amount, assigned_by -> users(id), assigned_at, updated_at
)

reading_club_stage_completions(        -- append-only, never deleted
  id, student_id -> library_students(id), episode_id -> reading_club_episodes(id), group_id, stage_id,
  target_amount_at_completion, progress_amount_at_completion,
  completed_at, marked_by -> users(id),
  reward_status CHECK(pending|delivered), reward_delivered_at, reward_delivered_by -> users(id)
)

reading_club_stage_book_entries(       -- per-stage "books read this stage" tracking (item D)
  id, student_id -> library_students(id), episode_id, group_id, stage_id,
  borrowing_id -> library_borrowings(id) NULL,   -- set for auto-sourced, NULL for manual
  book_copy_id -> library_catalog_book_copies(id) NULL,
  book_title, book_code NULL,                     -- snapshotted at entry time
  source CHECK(auto|manual), comments NULL,
  added_by -> users(id), added_at,
  status CHECK(active|discarded) DEFAULT active, discarded_at NULL, discarded_by NULL, discard_reason NULL
)
```

- A "reader" is the same `library_students` row `library_circulation`'s scan screen already resolves (`dependsOn: ["library_circulation"]`) — this module never creates its own reader/student entity.
- **Episodes (seasons/years) own groups fully** (READING_CLUB-D10) — every group belongs to exactly one episode; a stage inherits its episode from its own group (no separate `episode_id` column on stages). One global "current" episode at a time, enforced by a partial unique index `CREATE UNIQUE INDEX ... ON reading_club_episodes (is_current) WHERE is_current`. Starting a new episode (`EpisodesService.createEpisode`) closes whatever was previously current in the same transaction. Reads across groups/memberships/completions/dashboard default to the current episode but accept an optional `episodeId` so a past, closed episode stays browsable read-only; writes against a non-current episode are always rejected (409/400) — see READING_CLUB-D12.
- `target_amount` on a stage is THAT STAGE'S OWN amount, not cumulative — "stage 1 = 5 books, stage 2 = an additional 10 books" is `target_amount` 5 then 10.
- Progress for a `books`-type stage is computed **live**, never stored: a count of `library_borrowings` with `status = 'returned' AND returned_at >= stage_started_at` for that reader, read directly off `library_circulation`'s own tables through this module's own `PrismaClient` — the same "a module reads its `dependsOn` dependency's tables directly, coupled only through the shared DB schema" pattern `library_circulation`'s own `CirculationService` already established for `library_catalog`. Progress for a `pages`-type stage has no such data source anywhere in the catalog, so it's the librarian's own manually-recorded `manual_progress_amount` — see `DECISIONS.md`.
- `reading_club_stage_completions` is append-only and never deleted — same "reading passport" permanence philosophy as `library_circulation` (`docs/LIBRARY_MODULE_REQUIREMENTS.md` §10). A group/stage can never be deleted once any reader has been assigned to it or completed a stage in it.
- Marking a stage complete (`StageCompletionsService.markComplete`) does TWO things in one transaction: creates the completion snapshot (`reward_status = 'pending'`) AND immediately advances the membership to the next stage (or to no stage at all, if it was the group's last one). Reward **delivery** is tracked independently via `confirmReward` — a librarian can hand over the actual present later without blocking the reader's progression.
- **Per-stage book tracking** (`reading_club_stage_book_entries`, READING_CLUB-D13): every `library_borrowings` row returned inside the reader's current stage window (`returnedAt >= stageStartedAt` — the SAME window `computeStageProgress` uses) is auto-synced whenever a reader's detail is viewed (`MembershipsService.getReaderDetail` → `syncStageBookEntries`), for BOTH books-type and pages-type stages. Dedup is by `borrowing_id` existence regardless of status (a discarded auto-entry is never re-synced). A librarian can also add a free-typed manual entry (`source='manual'`, no `borrowing_id`). Every entry — auto or manual — supports both a soft **discard** (`status='discarded'`, stays visible struck-through, excluded from counts, optional reason) and a hard **delete** (gone entirely).

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
| `reading_club.dashboard.view` | `GET /dashboard` (groups/stages statistics, including the cross-reader pending-rewards list, item C) |
| `reading_club.episodes.manage` | `POST /episodes` (start a new episode, closing whatever was current) |

`GET /episodes`, `GET /episodes/current`, `GET /episodes/:id` are gated by `reading_club.groups.view` (READING_CLUB-D12), not a dedicated read permission — see that decision entry for the reasoning. Per-stage book-entry mutations (add/discard/delete, item D) reuse `reading_club.memberships.update_progress` — see READING_CLUB-D14.

`defaultRolePermissions`: `admin` gets all 11 (including `episodes.manage`). `library_assistant` (the platform's own mapping of "the librarian", per `docs/LIBRARY_MODULE_REQUIREMENTS.md` §1) also gets all 11 by default — the librarian requirement explicitly wants them defining groups/stages/episodes themselves, unlike `library_circulation`'s own `loan_policy` setting (admin/finance-only by default). `finance`/`reader` get none.

## Routes

Backend, all under `api/reading-club`, `MustChangePasswordGuard` + the global `JwtAuthGuard`/`PermissionGuard`:
- `GET /episodes`, `GET /episodes/current`, `GET /episodes/:id`, `POST /episodes`
- `GET/POST /groups` (`?episodeId=` optional on the list), `GET/PATCH/DELETE /groups/:id`, `GET/POST /groups/:groupId/stages`, `PATCH/DELETE /groups/stages/:stageId`
- `GET /readers` (`?episodeId=`/`?groupId=`/`?stageId=`/`?search=`), `GET /readers/:studentId`, `POST /readers/assign`, `POST /readers/:studentId/move-stage`, `PUT /readers/:studentId/progress`
- `POST /readers/:studentId/complete-stage`, `GET /readers/:studentId/pending-rewards`, `POST /stage-completions/:completionId/confirm-reward`
- `GET/POST /readers/:studentId/book-entries`, `PATCH /readers/:studentId/book-entries/:entryId/discard`, `DELETE /readers/:studentId/book-entries/:entryId`
- `GET /dashboard` (`?episodeId=`) — includes `pendingRewards: PendingRewardWithReader[]` alongside the existing `pendingRewardsCount`

Frontend, all `access: "authenticated"` under `basePath: "/reading-club"` — no public routes:
- `/reading-club/dashboard` → `DashboardPage.tsx` (episode switcher + pending-rewards table)
- `/reading-club/readers` → `ReadersListPage.tsx` (filters: `?groupId=`, `?stageId=`, `?episodeId=`, free-text search)
- `/reading-club/readers/:studentId` → `ReaderDetailPage.tsx` (completion history with group/stage columns, item B; "books read this stage" card, item D)
- `/reading-club/groups` → `GroupsListPage.tsx` (also where stages are managed, via `StagesManagerDialog`)
- `/reading-club/episodes` → `EpisodesPage.tsx` (list episodes, start a new one)

## Key files

- `backend/episodes.service.ts` — episode CRUD/current-episode logic; `createEpisode` closes whatever was current and opens the new one in one transaction; `assertEpisodeIsCurrent` is the single reusable rejection check every write-path in this module now calls.
- `backend/groups.service.ts` — group + stage CRUD (episode-scoped reads/writes), the dashboard aggregate query.
- `backend/memberships.service.ts` — reader search/filter/detail, assignment, manual stage moves, **`computeStageProgress`** (the books-vs-pages progress logic, see Data model above), and **`syncStageBookEntries`** (the per-stage book-entries auto-sync, called from `getReaderDetail`).
- `backend/stage-book-entries.service.ts` — manual add / discard / hard-delete for `reading_club_stage_book_entries` (item D); `MembershipsService` owns the auto-sync half, this service owns the CRUD half.
- `backend/stage-completions.service.ts` — `markComplete`/`confirmReward`/`listPendingRewards`/**`listAllPendingRewards`** (the cross-reader dashboard list, item C); sends real in-app notifications on both events (never lets a notification failure fail the underlying action, same pattern as `library_circulation.CirculationService.notifyStudent`).
- `frontend/pages/EpisodesPage.tsx` / `EpisodeSwitcher.tsx` — the episode management page and the reusable `<Select>` embedded in Dashboard/Groups/Readers toolbars (placement choice, READING_CLUB-D12).
- `frontend/pages/StagesManagerDialog.tsx` — the actual "librarian defines the stages, the amount, the reward, the order" configuration surface (see `DECISIONS.md` for why this is plain CRUD, not the manifest `settings[]` mechanism).
- `frontend/circulationIntegration.ts` — a small, deliberately import-free (no static cross-module TS import) helper that lists `library_circulation`'s students for the "assign a reader" picker.
- `modules/library_circulation/frontend/readingClubIntegration.ts` (in the OTHER module) — the mirror-image helper for the scan-page hook; see that module's own `DOCUMENTATION.md`/`DECISIONS.md` too.

## Known gotchas / deliberate v1 scope cuts

- **No page-count data exists anywhere in the catalog** — `library_catalog_books` has no page-count column, so a `pages`-type stage's progress can never be computed automatically the way a `books`-type stage's can; it's the librarian's own manually-entered running total (`PUT /readers/:studentId/progress`). Don't silently "fix" this by inventing a page-count field on `library_catalog` from inside this module — that's a cross-module schema change belonging to `library_catalog` itself, raise it with the user first.
- **A reader belongs to exactly one group at a time** (`student_id` is UNIQUE on `reading_club_memberships`) — "moving" a reader to a different group is an upsert that overwrites the previous membership row, not a second row. Reward/completion HISTORY from the previous group is untouched (`reading_club_stage_completions` is keyed by student/group/stage independently, never cascaded).
- **No student-facing self-view** — every screen in this module needs staff-level permissions; a `reader`-role user cannot see their own reading-club progress today (not requested; the librarian's own requirements are staff-only). Raise it with the user before adding a self-service page.
- **No Excel import/export** for groups/stages/readers — not requested, and `library_circulation`'s own Excel import is itself still deferred (that module's `DOCUMENTATION.md`).
- **No reporting/analytics beyond the dashboard's stat cards** — no per-staff activity report, no time-filtered breakdowns (the dashboard shows live counts only, matching `library_circulation`'s own §18-vs-§19/20 scope cut).
- **All pre-existing reading_club data was deleted by migration 002** (episodes introduction) — a deliberate, user-confirmed-twice, irreversible choice since the data was pre-production/planning-stage. See READING_CLUB-D11. A future migration touching real production data must NEVER do this.
- **A group's `episodeId` is fixed at creation** — there's no "move a group to another episode" operation. A stage inherits its episode from its own group's `episode_id`, so it never needs (and never gets) its own `episode_id` column — don't add one; join through `group_id` instead.
- **The book-entries auto-sync only runs from `MembershipsService.getReaderDetail`** (i.e., only when someone actually opens a reader's detail page) — it is not a background job and not triggered by `library_circulation` marking a borrowing returned. A returned book won't appear in `reading_club_stage_book_entries` until the reader's detail page is next opened by a staff member (acceptable latency for a school reading club; if a real-time requirement emerges, raise it with the user before adding a event-driven hook).

## Migration application (root PLATFORM-GAP-001 — manual until the platform gains auto-discovery)

### 001 — initial tables

1. Apply the SQL: `psql $DATABASE_URL -f modules/reading_club/migrations/001_create_reading_club_tables.sql`
2. Register it so the install flow's checksum check doesn't try to re-run it:
   `INSERT INTO module_migrations (module_key, filename, checksum) VALUES ('reading_club', '001_create_reading_club_tables.sql', '37933b4b5f15c4d43a1315cf0deee36cacc94b34c0887a9dfbd59ca234a4dbc4');`
3. `npx prisma generate` (never `prisma migrate`) from `apps/api/` to pick up the already-hand-maintained `ReadingClubGroup`/`ReadingClubStage`/`ReadingClubMembership`/`ReadingClubStageCompletion` models in `schema.prisma`.

See `DECISIONS.md` READING_CLUB-D8/D9 for the full reasoning and how this was verified against a real (non-Docker) local Postgres instance.

### 002 — episodes + per-stage book entries

**WARNING — irreversibly deletes all existing reading_club data first** (`TRUNCATE ... RESTART IDENTITY CASCADE` on groups/stages/memberships/completions), by deliberate, user-confirmed-twice design (READING_CLUB-D11) — only ever apply this to a pre-production database with nothing real to lose. Never copy this TRUNCATE-first pattern into a migration touching real production data.

1. Apply the SQL: `psql $DATABASE_URL -f modules/reading_club/migrations/002_add_episodes.sql`
2. Register it:
   `INSERT INTO module_migrations (module_key, filename, checksum) VALUES ('reading_club', '002_add_episodes.sql', '73ccbe0388e2c20ed97ff751beac3a3af4eabc50e79b49feede94f87fe8d1535');`
   — this is the real `sha256(file contents, 'utf8')` `MigrationRunnerService` computes (`apps/api/src/core/module-registry/migration-runner.service.ts`), verified two ways: Node `crypto.createHash('sha256').update(fs.readFileSync(path,'utf8')).digest('hex')` and PowerShell `Get-FileHash -Algorithm SHA256` — both produced the identical hash for this file's current content. Recompute if this file is ever edited before being applied (it never should be once applied, per D16).
3. `npx prisma generate` (never `prisma migrate`) from `apps/api/` to pick up the new `ReadingClubEpisode`/`ReadingClubStageBookEntry` models and the new `episodeId` fields on `ReadingClubGroup`/`ReadingClubMembership`/`ReadingClubStageCompletion` in `schema.prisma`.
4. After install, an admin (or `library_assistant`) must create the first episode via `POST /episodes` (or the Episodes page's "Start new episode" button) before any group can be created — `createGroup` requires a current episode to exist.

Verified end-to-end against a real Postgres 16 database (this repo's own `docker-compose` `db` service) — see READING_CLUB-D15.

## How to extend

Follow `docs/FEATURE_TEMPLATE.md` for any new endpoint (permission → guard → audit → locale keys in `ar`+`en` → tests). A new stage-configuration option (e.g. a due-by date per stage) starts in `CreateStageDto`/`UpdateStageDto` + the migration + `StagesManagerDialog.tsx`'s form. A new cross-module hook (this module reading from, or being read by, a THIRD module) should follow the same "raw `apiClient` endpoint call, never a static cross-module TS import" pattern this module and `library_circulation` already use both directions — see `DECISIONS.md`.
