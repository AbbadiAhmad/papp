"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMISSION_CHECKER = void 0;
/**
 * Structural stand-in for core's `PermissionsService` (same pattern and
 * reasoning as `modules/library_circulation/backend/permission-checker.ts`).
 * `reading-club.module.ts` is the one place binding the real class.
 */
exports.PERMISSION_CHECKER = Symbol('PERMISSION_CHECKER');
