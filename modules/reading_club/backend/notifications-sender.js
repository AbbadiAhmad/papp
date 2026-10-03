"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTIFICATIONS_SENDER = void 0;
/**
 * A structural stand-in for core's real `NotificationsService.send()`, used
 * ONLY as an injection token/interface — never imports the real class.
 * Copied from `modules/library_circulation/backend/notifications-sender.ts`
 * (root D74) — see that file's own docblock for the full rationale: a Jest
 * unit test importing a `.ts` file that top-level `import`s from
 * `apps/api/dist/...` crashes at module-load time, so
 * `memberships.service.ts`/`stage-completions.service.ts` depend on this
 * local interface + `Symbol` token instead of the real class.
 * `reading-club.module.ts` (never unit-tested — pure Nest wiring) is the
 * ONE place that imports the real `NotificationsService` and binds it here.
 */
exports.NOTIFICATIONS_SENDER = Symbol('NOTIFICATIONS_SENDER');
