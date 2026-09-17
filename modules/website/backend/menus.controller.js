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
exports.MenusController = void 0;
const common_1 = require("@nestjs/common");
const replace_menu_items_dto_1 = require("./dto/replace-menu-items.dto");
const menus_service_1 = require("./menus.service");
const platform_1 = require("./platform");
let MenusController = class MenusController {
    menus;
    constructor(menus) {
        this.menus = menus;
    }
    async list(location) {
        return this.menus.list(location);
    }
    async replace(location, dto) {
        return this.menus.replace(location, dto.items);
    }
};
exports.MenusController = MenusController;
__decorate([
    (0, common_1.Get)(':location'),
    (0, platform_1.RequirePermission)('website.menus.view'),
    __param(0, (0, common_1.Param)('location')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MenusController.prototype, "list", null);
__decorate([
    (0, common_1.Put)(':location'),
    (0, platform_1.RequirePermission)('website.menus.update'),
    (0, platform_1.Audit)({ category: 'website.menus', entityType: 'WebsiteMenuItem', action: 'update' }),
    __param(0, (0, common_1.Param)('location')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, replace_menu_items_dto_1.ReplaceMenuItemsDto]),
    __metadata("design:returntype", Promise)
], MenusController.prototype, "replace", null);
exports.MenusController = MenusController = __decorate([
    (0, common_1.Controller)('api/website/menus'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [menus_service_1.MenusService])
], MenusController);
