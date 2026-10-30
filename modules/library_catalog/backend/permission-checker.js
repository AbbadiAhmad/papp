"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTES_VIEW_PERMISSION = exports.PERMISSION_CHECKER = void 0;
/**
 * A structural stand-in for core's `PermissionsService`, used only as an injection token + interface — same
 * reasoning as library_circulation's `permission-checker.ts` (root D74): importing the real class from
 * `apps/api/dist` into a file a Jest unit test loads breaks that test at module-load time.
 * `library-catalog.module.ts` is the one place that binds the real `PermissionsService` to this token.
 *
 * Needed because ONE response depends on a second permission: the book list/detail are gated by `books.view`, but
 * the staff-only internal notes inside them are returned only to callers who also hold `notes.view`
 * (LIBRARY_CATALOG-D35), and the global PermissionGuard checks just the route's single code.
 */
exports.PERMISSION_CHECKER = Symbol('PERMISSION_CHECKER');
exports.NOTES_VIEW_PERMISSION = 'library_catalog.notes.view';
