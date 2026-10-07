"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMISSION_CHECKER = void 0;
/**
 * A structural stand-in for core's `PermissionsService`, used only as an
 * injection token + interface — same reasoning as `notifications-sender.ts`
 * (read its docblock): importing the real class from `apps/api/dist` into a
 * file a Jest unit test loads breaks that test at module-load time.
 * `library-circulation.module.ts` is the one place that binds the real
 * `PermissionsService` to this token.
 *
 * Needed because one request (return + "paid now") spans two permissions —
 * `return` (the route's own gate) and `finance.record_payment` — and the
 * global PermissionGuard only checks the route's single code.
 */
exports.PERMISSION_CHECKER = Symbol('PERMISSION_CHECKER');
