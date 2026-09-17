/**
 * A structural stand-in for core's real `NotificationsService.send()`, used
 * ONLY as an injection token/interface — never imports the real class.
 *
 * Why this file exists (read before "simplifying" it away): `circulation.service.ts`/
 * `fines.service.ts` need to call the real Notification Center, but the real
 * `NotificationsService` class lives in `apps/api/dist/...` (D57/D64's
 * established cross-module-import exception). A Jest **unit** test that
 * imports a `.ts` file with a top-level `import ... from
 * 'apps/api/dist/...'` statement crashes at module-load time — before any
 * test even runs — because that compiled `.js` file's own
 * `require('@nestjs/common')` throws under this repo's ESM-only-Nest/
 * experimental-vm-modules Jest setup (papp-add-feature SKILL.md's "Known
 * gotchas", root D68 item 3). Importing the real class as a TYPE ONLY
 * doesn't help either — `emitDecoratorMetadata` needs a real (non-erased)
 * reference to the constructor parameter's type for Nest's DI to resolve it
 * by type, so `import type` would break real dependency injection instead.
 *
 * The fix: `circulation.service.ts`/`fines.service.ts` depend on THIS local
 * interface + a `Symbol` injection token instead of the real class — zero
 * framework imports beyond `@nestjs/common`'s own `Inject`, so importing
 * them into a Jest unit test is safe. `library-circulation.module.ts` (never
 * unit-tested — it's pure Nest wiring) is the ONE place that imports the
 * real `NotificationsService` from `apps/api/dist/...` and binds it to this
 * token via `{ provide: NOTIFICATIONS_SENDER, useExisting: NotificationsService }`,
 * so the real running app behaves identically — only the unit-testability
 * of the two services depending on it changes.
 */
export const NOTIFICATIONS_SENDER = Symbol('NOTIFICATIONS_SENDER');

export interface NotificationsSenderInput {
  category: string;
  title: string;
  bodyMarkdown: string;
  targetType: 'user';
  targetId: string;
  sentBy: string | null;
}

export interface NotificationsSender {
  send(input: NotificationsSenderInput): Promise<unknown>;
}
