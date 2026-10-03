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
 * Copied from modules/library_catalog/backend/platform.ts (D57) — see that
 * file's own docblock, and this module's own DOCUMENTATION.md, for the full
 * rationale. Short version: a dynamically-installed module (MODULE_SPEC.md
 * §1/§4, D15) can't import `apps/api/src/common/**` directly (that TS source
 * tree is never present as loadable JS at the path a running process would
 * need), so every module re-declares `@Public()`/`@RequirePermission()`/
 * `@Audit()`/`@CurrentUser()` as thin metadata shims against the EXACT SAME
 * literal keys the real global guards read — a plugin-contract, not a
 * reimplementation of any actual security/audit logic, which still runs
 * entirely inside core's own global guards/interceptor. `MustChangePasswordGuard`
 * is different: real, if small, business logic, reimplemented in full here
 * (not global — every controller applies it locally, same as core's own).
 *
 * `PublicThrottlerGuard` is NOT re-implemented here either: this module
 * imports the REAL class from `apps/api/dist/common/guards/public-throttler.guard`
 * (built output, not `src/`) for its own public route — see
 * backend/public-items.controller.ts. This is THE one file every new module
 * should copy verbatim as its starting point (docs/MODULE_SPEC.md §10) — if
 * you're only changing one thing here, you're probably doing it wrong.
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
