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
  group_id -> reading_club_groups(id) NULL ON DELETE SET NULL, group_name NULL,       -- (READING_CLUB-D16)
  current_stage_id -> reading_club_stages(id) NULL ON DELETE SET NULL, stage_name NULL, -- (READING_CLUB-D16)
  stage_started_at, manual_progress_amount, assigned_by -> users(id), assigned_at, updated_at
)

reading_club_stage_completions(        -- append-only, never deleted
  id, student_id -> library_students(id), episode_id -> reading_club_episodes(id),
  group_id NULL ON DELETE SET NULL, group_name NULL,                                  -- (READING_CLUB-D16)
  stage_id NULL ON DELETE SET NULL, stage_name NULL, stage_order NULL,                -- (READING_CLUB-D16)
  target_amount_at_completion, progress_amount_at_completion,
  completed_at, marked_by -> users(id),
  reward_status CHECK(pending|delivered), reward_delivered_at, reward_delivered_by -> users(id)
)

reading_club_stage_book_entries(       -- per-stage "books read this stage" tracking (item D)
  id, student_id -> library_students(id), episode_id,
  group_id NULL ON DELETE SET NULL, group_name NULL,                                  -- (READING_CLUB-D16)
  stage_id NULL ON DELETE SET NULL, stage_name NULL,                                  -- (READING_CLUB-D16)
  borrowing_id -> library_borrowings(id) NULL,   -- set for auto-sourced, NULL for manual
  book_copy_id -> library_catalog_book_copies(id) NULL,
  book_title, book_code NULL, page_count NULL CHECK(page_count IS NULL OR page_count > 0), -- snapshotted at entry time (page_count: READING_CLUB-D18, migration 004)
  source CHECK(auto|manual), comments NULL,
  added_by -> users(id), added_at,
  status CHECK(active|discarded) DEFAULT active, discarded_at NULL, discarded_by NULL, discard_reason NULL
)
```

- A "reader" is the same `library_students` row `library_circulation`'s scan screen already resolves (`dependsOn: ["library_circulation"]`) — this module never creates its own reader/student entity.
- **Episodes (seasons/years) own groups fully** (READING_CLUB-D10) — every group belongs to exactly one episode; a stage inherits its episode from its own group (no separate `episode_id` column on stages). One global "current" episode at a time, enforced by a partial unique index `CREATE UNIQUE INDEX ... ON reading_club_episodes (is_current) WHERE is_current`. Starting a new episode (`EpisodesService.createEpisode`) closes whatever was previously current in the same transaction. Reads across groups/memberships/completions/dashboard default to the current episode but accept an optional `episodeId` so a past, closed episode stays browsable read-only; writes against a non-current episode are always rejected (409/400) — see READING_CLUB-D12.
- **Any episode can be deleted, including the current one — a real, full cascade delete, not history-preserving** (READING_CLUB-D17, unlike group/stage deletion's READING_CLUB-D16). Deleting an episode deletes its own groups/stages and every membership/completion/book-entry carrying its `episode_id` — if the episode is gone, everything scoped under it is gone too, full stop. **"No current episode" is a normal, gracefully-handled state, not an error** — deleting the current episode leaves none current (no auto-promotion of another one); every read path that used to assume a current episode always exists (`GroupsService.listGroups`/`getDashboardStats`, `MembershipsService.listReaders`, `StageCompletionsService.getPendingRewardsCount`/`listAllPendingRewards`) now resolves via `EpisodesService.findCurrentEpisodeOrNull()` and returns an empty/all-zero result instead of throwing when none exists. The one exception: `GroupsService.createGroup` still throws when asked to default to a current episode that doesn't exist — you cannot create a group with no episode context, so that failure is correct, not a gap.
- `target_amount` on a stage is THAT STAGE'S OWN amount, not cumulative — "stage 1 = 5 books, stage 2 = an additional 10 books" is `target_amount` 5 then 10.
- Progress for a `books`-type stage is computed **live**, never stored: a count of `library_borrowings` with `status = 'returned' AND returned_at >= stage_started_at` for that reader, read directly off `library_circulation`'s own tables through this module's own `PrismaClient` — the same "a module reads its `dependsOn` dependency's tables directly, coupled only through the shared DB schema" pattern `library_circulation`'s own `CirculationService` already established for `library_catalog`.
- **Progress for a `pages`-type stage (READING_CLUB-D18, migration 004 — supersedes the original v1 "manual-only" design)**: `MembershipsService.computeStageProgress` sums `page_count` across the reader's ACTIVE `reading_club_stage_book_entries` rows for the current stage (both auto-synced entries, snapshotted from `library_catalog_books.page_count` at sync time, and manual entries, where the librarian types a page count directly) **plus** `manual_progress_amount` on top as an adjustment — not a competing source of truth, just a correction for what the entry list can't capture (a partially-read book, etc.). A `page_count` of `NULL` (book has no catalog page count, or a manual entry left it blank) contributes 0, never an error. Before D18, `manual_progress_amount` was pages progress's ONLY source; it now defaults to 0 on every new assignment/stage-move and only grows when the librarian explicitly uses "Update page progress".
- `reading_club_stage_completions` is append-only and never deleted — same "reading passport" permanence philosophy as `library_circulation` (`docs/LIBRARY_MODULE_REQUIREMENTS.md` §10). **A group/stage CAN now be deleted even with history against it** (READING_CLUB-D16, migration 003) — a deliberate reversal of the original v1 rule, on explicit user request, so a librarian can reconfigure a season's groups/stages without losing that season's already-earned reward/completion history. `group_id`/`stage_id`/`current_stage_id` on every history table (`reading_club_memberships`, `reading_club_stage_completions`, `reading_club_stage_book_entries`) are nullable with `ON DELETE SET NULL` — deleting the live group/stage row nulls these out automatically, and the row's own `group_name`/`stage_name` snapshot (see next bullet) keeps it displaying correctly. `reading_club_stages.group_id -> reading_club_groups(id)` itself is unchanged (still blocking/default) — a stage is owned by its group, and `removeGroup` already explicitly deletes a group's stages first, in a transaction, before deleting the group.
- **Every history row snapshots its group/stage NAME at write time, never re-derived from a live join** (READING_CLUB-D16): `reading_club_memberships.group_name`/`stage_name` (re-snapshotted on every `assign`/`moveStage` call), `reading_club_stage_completions.group_name`/`stage_name`/`stage_order` (snapshotted once, at `markComplete` time — same append-only philosophy as the pre-existing `target_amount_at_completion`/`progress_amount_at_completion`), `reading_club_stage_book_entries.group_name`/`stage_name` (snapshotted at entry-creation time, both auto-sync and manual-add paths). Every read path that displays a group/stage name (`getReaderDetail`, `listReaders`, `listPendingRewards`, `listAllPendingRewards`) reads these snapshot columns directly — the old `groupsById.get(...)`/`stagesById.get(...)` live-join pattern is gone for these fields, since it would silently return `null` the moment the live row is deleted. The one live lookup NOT replaced: `listPendingRewards`/`listAllPendingRewards`'s `rewardDescription` still does a live `readingClubStage` lookup (never snapshotted onto the completion) — a stage deleted between `markComplete` and `confirmReward` loses its reward-description TEXT in that list (the identifying group/stage NAME still shows correctly from the snapshot; only the reward text itself, an accepted documented gap, see DECISIONS.md).
- Marking a stage complete (`StageCompletionsService.markComplete`) does TWO things in one transaction: creates the completion snapshot (`reward_status = 'pending'`) AND immediately advances the membership to the next stage (or to no stage at all, if it was the group's last one). Reward **delivery** is tracked independently via `confirmReward` — a librarian can hand over the actual present later without blocking the reader's progression.
- **A reader's `currentStageId`/`groupId` can become `null` while their membership row still exists**, if the librarian deletes the group/stage they're actively assigned to (READING_CLUB-D16). `getReaderDetail`/`listReaders`/the dashboard all handle this without crashing — `group`/`stage`/`progress` come back `null`, `totalActiveReaders` still counts them, but they're not attributed to any group's per-group stats. The frontend shows a distinct "this reader's group was deleted" message (reading the membership's own `groupName` snapshot) rather than the generic "not assigned" message, so a librarian can tell the two cases apart and re-assign the reader.
- **Per-stage book tracking** (`reading_club_stage_book_entries`, READING_CLUB-D13): every `library_borrowings` row returned inside the reader's current stage window (`returnedAt >= stageStartedAt` — the SAME window `computeStageProgress` uses) is auto-synced whenever a reader's detail is viewed (`MembershipsService.getReaderDetail` → `syncStageBookEntries`), for BOTH books-type and pages-type stages. Dedup is by `borrowing_id` existence regardless of status (a discarded auto-entry is never re-synced). The linked book's `page_count` is snapshotted onto the entry at sync time (READING_CLUB-D18). A librarian can also add a free-typed manual entry (`source='manual'`, no `borrowing_id`, optionally typing in a `page_count` too). Every entry — auto or manual — supports both a soft **discard** (`status='discarded'`, stays visible struck-through, excluded from counts AND from the pages-progress sum, optional reason) and a hard **delete** (gone entirely).

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
- `GET /episodes`, `GET /episodes/current`, `GET /episodes/:id`, `POST /episodes`, `GET /episodes/:id/delete-preview`, `DELETE /episodes/:id` — the delete is a full cascade (READING_CLUB-D17): unlike group/stage deletion, no history is preserved. Any episode is deletable, including the current one — deleting it leaves no episode current (no auto-promotion). `delete-preview` returns real counts (`groupCount`/`readerCount`/`completionCount`/`bookEntryCount`) for the frontend's blast-radius warning before the librarian confirms.
- `GET/POST /groups` (`?episodeId=` optional on the list), `GET/PATCH/DELETE /groups/:id`, `GET/POST /groups/:groupId/stages`, `PATCH/DELETE /groups/stages/:stageId` — **`DELETE` on either now always succeeds, even with history/active readers against it (READING_CLUB-D16), and returns `{ affectedActiveReaderCount }` (200, not 204/No Content) instead of an empty body** — purely informational, the frontend's type-to-confirm dialog already warned about this count before calling it.
- `GET /readers` (`?episodeId=`/`?groupId=`/`?stageId=`/`?search=`), `GET /readers/:studentId`, `POST /readers/assign`, `POST /readers/:studentId/move-stage`, `PUT /readers/:studentId/progress`
- `POST /readers/:studentId/complete-stage`, `GET /readers/:studentId/pending-rewards`, `POST /stage-completions/:completionId/confirm-reward`
- `GET/POST /readers/:studentId/book-entries`, `PATCH /readers/:studentId/book-entries/:entryId/discard`, `DELETE /readers/:studentId/book-entries/:entryId`
- `GET /dashboard` (`?episodeId=`) — includes `pendingRewards: PendingRewardWithReader[]` alongside the existing `pendingRewardsCount`

Frontend, all `access: "authenticated"` under `basePath: "/reading-club"` — no public routes:
- `/reading-club/dashboard` → `DashboardPage.tsx` (episode switcher + pending-rewards table)
- `/reading-club/readers` → `ReadersListPage.tsx` (filters: `?groupId=`, `?stageId=`, `?episodeId=`, free-text search)
- `/reading-club/readers/:studentId` → `ReaderDetailPage.tsx` (completion history with group/stage columns, item B; "books read this stage" card, item D)
- `/reading-club/groups` → `GroupsListPage.tsx` (also where stages are managed, via `StagesManagerDialog`)
- `/reading-club/episodes` → `EpisodesPage.tsx` (list episodes, start a new one, delete one via type-to-confirm)

## Key files

- `backend/episodes.service.ts` — episode CRUD/current-episode logic; `createEpisode` closes whatever was current and opens the new one in one transaction; `assertEpisodeIsCurrent` is the single reusable rejection check every write-path in this module now calls. `deleteEpisode` (READING_CLUB-D17) does a full cascade delete — its own groups/stages plus every membership/completion/book-entry scoped to it — via an explicit ordered `$transaction`, no FK/migration change needed. `getDeletePreview` returns the real counts a delete would cascade away. `findCurrentEpisodeOrNull` (pre-existing, previously unused outside this file) is now the lookup every "default to current episode" read path uses instead of `getCurrentEpisode` — it resolves to `null` instead of throwing when no episode is current, since that's now a normal, reachable state (a librarian can delete the current episode and not yet have started a new one).
- `backend/groups.service.ts` — group + stage CRUD (episode-scoped reads/writes), the dashboard aggregate query. `removeGroup`/`removeStage` no longer block on history/active-reader presence (READING_CLUB-D16) — they return `{ affectedActiveReaderCount }` instead.
- `backend/memberships.service.ts` — reader search/filter/detail, assignment, manual stage moves, **`computeStageProgress`** (the books-vs-pages progress logic, see Data model above), and **`syncStageBookEntries`** (the per-stage book-entries auto-sync, called from `getReaderDetail`).
- `backend/stage-book-entries.service.ts` — manual add / discard / hard-delete for `reading_club_stage_book_entries` (item D); `MembershipsService` owns the auto-sync half, this service owns the CRUD half.
- `backend/stage-completions.service.ts` — `markComplete`/`confirmReward`/`listPendingRewards`/**`listAllPendingRewards`** (the cross-reader dashboard list, item C); sends real in-app notifications on both events (never lets a notification failure fail the underlying action, same pattern as `library_circulation.CirculationService.notifyStudent`).
- `frontend/pages/EpisodesPage.tsx` / `EpisodeSwitcher.tsx` — the episode management page and the reusable `<Select>` embedded in Dashboard/Groups/Readers toolbars (placement choice, READING_CLUB-D12).
- `frontend/pages/StageBookEntriesCard.tsx` — the "books read this stage" card on `ReaderDetailPage.tsx` (item D): auto/manual source chip, add-manual dialog, discard (optional reason) and delete (real `ConfirmDialog`) actions, all gated by `reading_club.memberships.update_progress`.
- `frontend/pages/StagesManagerDialog.tsx` — the actual "librarian defines the stages, the amount, the reward, the order" configuration surface (see `DECISIONS.md` for why this is plain CRUD, not the manifest `settings[]` mechanism). Its stage-delete button now goes through `TypeToConfirmDialog` (READING_CLUB-D16), not the plain `ConfirmDialog`.
- `frontend/pages/TypeToConfirmDialog.tsx` — a module-local, stronger confirmation dialog (type the group/stage's exact name to enable the delete button) used by `GroupsListPage.tsx` (group delete), `StagesManagerDialog.tsx` (stage delete), and now `EpisodesPage.tsx` (episode delete, READING_CLUB-D17) — the harder-to-fat-finger confirm is the safety net for an action that (for groups/stages) is no longer blocked by history, and (for episodes) never preserves history at all.
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

### 003 — snapshot names + allow delete with history

Lets a librarian delete a group/stage even with reader assignments/completion history against it, while every affected history row keeps displaying the right group/stage name forever (READING_CLUB-D16). Additive only — no data loss, no truncation (unlike 002).

1. Apply the SQL: `psql $DATABASE_URL -f modules/reading_club/migrations/003_snapshot_names_and_allow_delete.sql`
2. Register it:
   `INSERT INTO module_migrations (module_key, filename, checksum) VALUES ('reading_club', '003_snapshot_names_and_allow_delete.sql', '2e01c1f6ea5b223c930af2944315ae2451f8673f5a6678ed457aec5a8909697b');`
   — real `sha256(file contents, 'utf8')` (Node `crypto.createHash('sha256').update(fs.readFileSync(path,'utf8')).digest('hex')`), matching `MigrationRunnerService`'s own hashing method exactly (confirmed by reading that service's source). Recompute if this file is ever edited before being applied (it never should be once applied, per D16 root).
3. `npx prisma generate` (never `prisma migrate`) from `apps/api/` to pick up the new nullable `groupId`/`stageId`/`currentStageId` fields and the new `groupName`/`stageName`/`stageOrder` snapshot fields on `ReadingClubMembership`/`ReadingClubStageCompletion`/`ReadingClubStageBookEntry` in `schema.prisma`.

Verified end-to-end against this repo's own real running `docker-compose` Postgres 16 container (`p_app-db-1`) — see READING_CLUB-D16 for the full list of what was checked.

### 004 — page count on book entries

Adds `page_count INTEGER CHECK (page_count IS NULL OR page_count > 0)` to `reading_club_stage_book_entries` — consumes `library_catalog`'s own new `page_count` column (LIBRARY_CATALOG-D24, that module's migration 007). User request: "the book's page number should be recorded and used in the club module where the stages depend on pages." See READING_CLUB-D18 for the full reasoning. Additive only — no data loss, no truncation.

1. Apply the SQL: `psql $DATABASE_URL -f modules/reading_club/migrations/004_add_page_count_to_book_entries.sql`
2. Register it:
   `INSERT INTO module_migrations (module_key, filename, checksum) VALUES ('reading_club', '004_add_page_count_to_book_entries.sql', '0eff09f47009c4cf01cb804fca611818c15f65b32dc504d13af058dbe3b4a9be');`
   — real `sha256(file contents, 'utf8')`, computed with Node `crypto.createHash('sha256').update(fs.readFileSync(path,'utf8')).digest('hex')`, matching `MigrationRunnerService`'s own hashing method exactly. Recompute if this file is ever edited before being applied (it never should be once applied, per D16 root).
3. `npx prisma generate` (never `prisma migrate`) from `apps/api/` to pick up the new `pageCount Int?` field on `ReadingClubStageBookEntry` in `schema.prisma`. **Also apply `library_catalog`'s own migration 007 first (or at the same time)** — this module's auto-sync reads `library_catalog_books.page_count`, which doesn't exist until that migration runs.

`down/004_add_page_count_to_book_entries.sql` exists alongside it — drops the `page_count` column.

### Down migrations (root D48 / D86)

`migrations/down/001_create_reading_club_tables.sql`, `down/002_add_episodes.sql`, `down/003_snapshot_names_and_allow_delete.sql`, `down/004_add_page_count_to_book_entries.sql` now exist — the structural inverse of each same-numbered up-migration, applied in descending filename order (`004` → `003` → `002` → `001`) by `ModuleRegistryService.runDownMigrationsIfPresent` when an admin uninstalls this module with `--drop-data`. `004`'s down drops the `page_count` column it added, no caveats. `003`'s down restores the original (blocking) FK actions/NOT NULL constraints that migration relaxed and drops its snapshot columns (`groupName`/`stageName`/`stageOrder`) — note this step will fail loud if any live row currently has a NULL `groupId`/`stageId` from a post-003 group/stage deletion (READING_CLUB-D16's orphaned-membership case), since there is no group/stage to backfill NOT NULL against; this is only a real concern if this file is ever run outside a full `--drop-data` uninstall, since `down/001` drops these same tables entirely right after. `002`'s down drops `reading_club_stage_book_entries`, the `episodeId` columns/indexes on groups/memberships/completions, and `reading_club_episodes` itself — no TRUNCATE-style caveat needed here (dropping is always safe, unlike restoring NOT NULL). `001`'s down drops the four original tables (completions → memberships → stages → groups). Before this, `--drop-data` on this module silently left every table in place. See root D86 for the platform-level dependency guard added alongside this: uninstalling `library_circulation` while this module is still installed is now rejected outright (this module's own `dependsOn: ["library_circulation"]` is exactly what the guard reads).

## How to extend

Follow `docs/FEATURE_TEMPLATE.md` for any new endpoint (permission → guard → audit → locale keys in `ar`+`en` → tests). A new stage-configuration option (e.g. a due-by date per stage) starts in `CreateStageDto`/`UpdateStageDto` + the migration + `StagesManagerDialog.tsx`'s form. A new cross-module hook (this module reading from, or being read by, a THIRD module) should follow the same "raw `apiClient` endpoint call, never a static cross-module TS import" pattern this module and `library_circulation` already use both directions — see `DECISIONS.md`.
