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
exports.ItemsController = void 0;
const common_1 = require("@nestjs/common");
const create_item_dto_1 = require("./dto/create-item.dto");
const update_item_dto_1 = require("./dto/update-item.dto");
const items_service_1 = require("./items.service");
const platform_1 = require("./platform");
const fetchItemState = (prisma, req) => prisma.templateItem.findUnique({ where: { id: req.params.id } });
/**
 * The permission-gated CRUD surface (docs/FEATURE_TEMPLATE.md §1's worked
 * example, applied here) — `JwtAuthGuard`/`PermissionGuard` are GLOBAL
 * (apps/api/src/app.module.ts) and already cover every controller,
 * including a dynamically-mounted module's; only `MustChangePasswordGuard`
 * needs applying locally.
 */
let ItemsController = class ItemsController {
    items;
    constructor(items) {
        this.items = items;
    }
    async list() {
        return this.items.list();
    }
    async findById(id) {
        return this.items.findById(id);
    }
    async create(dto, user) {
        return this.items.create(dto, user.userId);
    }
    async update(id, dto) {
        return this.items.update(id, dto);
    }
    async remove(id) {
        await this.items.remove(id);
    }
};
exports.ItemsController = ItemsController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('template.items.view'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ItemsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, platform_1.RequirePermission)('template.items.view'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ItemsController.prototype, "findById", null);
__decorate([
    (0, common_1.Post)(),
    (0, platform_1.RequirePermission)('template.items.create'),
    (0, platform_1.Audit)({ category: 'template.items', entityType: 'TemplateItem', action: 'create' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_item_dto_1.CreateItemDto, Object]),
    __metadata("design:returntype", Promise)
], ItemsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, platform_1.RequirePermission)('template.items.update'),
    (0, platform_1.Audit)({ category: 'template.items', entityType: 'TemplateItem', action: 'update', fetchState: fetchItemState }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_item_dto_1.UpdateItemDto]),
    __metadata("design:returntype", Promise)
], ItemsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, platform_1.RequirePermission)('template.items.delete'),
    (0, platform_1.Audit)({ category: 'template.items', entityType: 'TemplateItem', action: 'delete', fetchState: fetchItemState }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ItemsController.prototype, "remove", null);
exports.ItemsController = ItemsController = __decorate([
    (0, common_1.Controller)('api/template/items'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [items_service_1.ItemsService])
], ItemsController);
