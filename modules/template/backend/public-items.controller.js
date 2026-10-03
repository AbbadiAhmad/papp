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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicItemsController = void 0;
const common_1 = require("@nestjs/common");
// The REAL core guard, imported from apps/api's BUILT output (never `src/`)
// — see platform.ts's docblock / modules/library_catalog/backend/public.controller.ts
// for exactly why (D57's exception category — genuine shared logic, not a
// metadata marker, is the one thing a module imports for real).
// eslint-disable-next-line import/no-unresolved
const public_throttler_guard_1 = require("../../../apps/api/dist/common/guards/public-throttler.guard");
const items_service_1 = require("./items.service");
const platform_1 = require("./platform");
/**
 * The one deliberate PUBLIC route (docs/MODULE_SPEC.md §7): reachable with
 * NO `Authorization` header at all — mounted directly by App.tsx in every
 * auth-status branch, never behind a login redirect. `@Public()` makes the
 * global `JwtAuthGuard` short-circuit to "no user" and `PermissionGuard`
 * no-op (no `@RequirePermission` here — RBAC is meaningless for an
 * anonymous visitor, §7.1). `ItemsService.getPublicIfActive` is the actual
 * access rule ("only a currently-active item, and never its owner"), a
 * plain 404 for anything else — never a permission error a visitor with no
 * account could never resolve.
 *
 * `PublicThrottlerGuard` here is applied even on this READ for consistency
 * with `library_catalog`'s own public route (see its own docblock) — not
 * strictly required for a read (MODULE_SPEC.md §7.3 only makes it
 * mandatory for a public WRITE), but cheap insurance against scraping.
 */
let PublicItemsController = class PublicItemsController {
    items;
    constructor(items) {
        this.items = items;
    }
    async findById(id) {
        return this.items.getPublicIfActive(id);
    }
};
exports.PublicItemsController = PublicItemsController;
__decorate([
    (0, common_1.Get)(':id'),
    (0, platform_1.Public)(),
    (0, common_1.UseGuards)(public_throttler_guard_1.PublicThrottlerGuard),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicItemsController.prototype, "findById", null);
exports.PublicItemsController = PublicItemsController = __decorate([
    (0, common_1.Controller)('api/template/public/items'),
    __metadata("design:paramtypes", [items_service_1.ItemsService])
], PublicItemsController);
