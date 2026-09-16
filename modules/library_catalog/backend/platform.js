"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MustChangePasswordGuard = exports.CurrentUser = exports.Audit = exports.AUDIT_KEY = exports.RequirePermission = exports.REQUIRE_PERMISSION_KEY = exports.Public = exports.IS_PUBLIC_KEY = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const common_2 = require("@nestjs/common");
/**
 * *** Why this file exists (read before touching it) ***
 *
 * A dynamically-installed module (MODULE_SPEC.md §1/§4, D15) is loaded via
 * `apps/api/src/core/module-registry/module-loader.ts`'s
 * `await import(entryPath)` against a path this module ships at
 * `modules/library_catalog/backend/library-catalog.module.js` (a plain
 * compiled CommonJS file — see this module's own tsconfig.json and the
 * Developer agent's final report for why `.js`, not the MODULE_SPEC.md
 * illustrative example's literal `.ts`, is what module-loader.ts can
 * actually import under plain Node).
 *
 * `apps/api/src/common/decorators/*` and most of its guards are real,
 * substantial platform code — but they live in `apps/api/src/**`, a
 * TypeScript source tree that is NEVER present as loadable JavaScript at the
 * exact relative path a naive `require('../../../apps/api/src/...')` would
 * need (the running api process always executes `apps/api/dist/**`, per
 * apps/api/Dockerfile's `CMD ["node", "dist/main.js"]` and `start:prod`).
 * A hand-authored module's own compiled output keeps whatever import
 * specifier its source wrote, verbatim — TypeScript does not rewrite paths.
 *
 * `@Public()`, `@RequirePermission(code)` and `@Audit(...)` are pure
 * metadata markers (`SetMetadata(key, value)`, read back by
 * `Reflector.getAllAndOverride` inside the platform's GLOBAL guards/
 * interceptor — `JwtAuthGuard`/`PermissionGuard`/`AuditInterceptor`, all
 * registered once as `APP_GUARD`/`APP_INTERCEPTOR` in `app.module.ts` and
 * therefore already applied to every controller in the merged root module,
 * including this dynamically-loaded one, with ZERO wiring needed on this
 * module's side). Re-declaring them here, against the EXACT SAME literal
 * metadata keys the real guards read (`'isPublic'`, `'requiredPermission'`,
 * `'auditMetadata'` — copied verbatim from
 * apps/api/src/common/decorators/{public,require-permission,audit}.decorator.ts),
 * is a plugin-style EXTENSION-POINT CONTRACT, not a reimplementation of any
 * actual security/audit logic: the real logic still runs entirely inside
 * core's own guards/interceptor. This is the only way an independently
 * loaded module can hook into those cross-cutting concerns without a
 * fragile, extension-losing import of core's own TypeScript source.
 *
 * `MustChangePasswordGuard` is different: every core controller applies it
 * locally (it is deliberately NOT global — see its own docblock in
 * apps/api/src/common/guards/must-change-password.guard.ts), so this module
 * needs its own instance of that same small, real check to keep the
 * platform-wide "force-password-change blocks every other endpoint" rule
 * true here too. It is reimplemented in full below (not just a metadata
 * shim) because it is genuine, if small, business logic — but it is exactly
 * the same ~10 lines as the original, reading the exact same
 * `request.user.mustChangePassword` flag `JwtAuthGuard` (global) already
 * populated. If core's version ever changes behavior, this copy must be
 * updated to match — flagged in this Developer agent's final report as a
 * real maintenance cost of there being no shared `@papp/platform-kit`
 * package modules can import from yet.
 *
 * `PublicThrottlerGuard` is NOT re-implemented here: this module imports the
 * REAL class from `apps/api/dist/common/guards/public-throttler.guard`
 * (built output, not `src/`) — see public.controller.ts for why: proving
 * the actual shared, admin-tunable rate limiter is this phase's explicit
 * purpose (BUILD_PLAN.md Phase 8), so a local reimplementation would defeat
 * the point. That one deliberate cross-repo import is exactly why apps/api
 * must be built (`npm run build --workspace=@papp/api`) BEFORE this
 * module's own backend is loaded — true in every real deployment already
 * (Dockerfile builds apps/api first; `nest start`/`nest build` always
 * compile to dist before the process that would dynamically import this
 * module even starts running).
 */
// --- @Public() ----------------------------------------------------------
// Mirrors apps/api/src/common/decorators/public.decorator.ts exactly.
exports.IS_PUBLIC_KEY = 'isPublic';
const Public = () => (0, common_1.SetMetadata)(exports.IS_PUBLIC_KEY, true);
exports.Public = Public;
// --- @RequirePermission(code) --------------------------------------------
// Mirrors apps/api/src/common/decorators/require-permission.decorator.ts exactly.
exports.REQUIRE_PERMISSION_KEY = 'requiredPermission';
const RequirePermission = (code) => (0, common_1.SetMetadata)(exports.REQUIRE_PERMISSION_KEY, code);
exports.RequirePermission = RequirePermission;
// --- @Audit({...}) --------------------------------------------------------
// Mirrors apps/api/src/common/decorators/audit.decorator.ts exactly,
// PrismaClient substituted for PrismaService (structurally compatible —
// PrismaService just adds lifecycle hooks) so this file needs no core import.
exports.AUDIT_KEY = 'auditMetadata';
const Audit = (metadata) => (0, common_1.SetMetadata)(exports.AUDIT_KEY, metadata);
exports.Audit = Audit;
exports.CurrentUser = (0, common_2.createParamDecorator)((_data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
});
// --- MustChangePasswordGuard ----------------------------------------------
// Real (small) reimplementation — see this file's docblock above.
const ALLOW_MUST_CHANGE_PASSWORD_KEY = 'allowMustChangePassword';
let MustChangePasswordGuard = class MustChangePasswordGuard {
    reflector;
    constructor(reflector) {
        this.reflector = reflector;
    }
    canActivate(context) {
        const allowed = this.reflector.getAllAndOverride(ALLOW_MUST_CHANGE_PASSWORD_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (allowed)
            return true;
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (user?.mustChangePassword) {
            throw new common_1.ForbiddenException('Password change required before continuing');
        }
        return true;
    }
};
exports.MustChangePasswordGuard = MustChangePasswordGuard;
exports.MustChangePasswordGuard = MustChangePasswordGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector])
], MustChangePasswordGuard);
