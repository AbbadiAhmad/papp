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
exports.PagesController = void 0;
const common_1 = require("@nestjs/common");
const create_page_dto_1 = require("./dto/create-page.dto");
const replace_blocks_dto_1 = require("./dto/replace-blocks.dto");
const update_page_dto_1 = require("./dto/update-page.dto");
const platform_1 = require("./platform");
const pages_service_1 = require("./pages.service");
const fetchPageState = (prisma, req) => prisma.websitePage.findUnique({ where: { id: req.params.id } });
let PagesController = class PagesController {
    pages;
    constructor(pages) {
        this.pages = pages;
    }
    async list() {
        return this.pages.list();
    }
    async findById(id) {
        return this.pages.findById(id);
    }
    async create(dto) {
        return this.pages.create(dto);
    }
    async update(id, dto) {
        return this.pages.update(id, dto);
    }
    async remove(id) {
        await this.pages.remove(id);
    }
    async publish(id) {
        return this.pages.publish(id);
    }
    async unpublish(id) {
        return this.pages.unpublish(id);
    }
    async replaceBlocks(id, dto) {
        return this.pages.replaceBlocks(id, dto.blocks);
    }
};
exports.PagesController = PagesController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('website.pages.view'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PagesController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, platform_1.RequirePermission)('website.pages.view'),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PagesController.prototype, "findById", null);
__decorate([
    (0, common_1.Post)(),
    (0, platform_1.RequirePermission)('website.pages.create'),
    (0, platform_1.Audit)({ category: 'website.pages', entityType: 'WebsitePage', action: 'create' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_page_dto_1.CreatePageDto]),
    __metadata("design:returntype", Promise)
], PagesController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, platform_1.RequirePermission)('website.pages.update'),
    (0, platform_1.Audit)({ category: 'website.pages', entityType: 'WebsitePage', action: 'update', fetchState: fetchPageState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_page_dto_1.UpdatePageDto]),
    __metadata("design:returntype", Promise)
], PagesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, platform_1.RequirePermission)('website.pages.delete'),
    (0, platform_1.Audit)({ category: 'website.pages', entityType: 'WebsitePage', action: 'delete', fetchState: fetchPageState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PagesController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/publish'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, platform_1.RequirePermission)('website.pages.publish'),
    (0, platform_1.Audit)({ category: 'website.pages', entityType: 'WebsitePage', action: 'update', fetchState: fetchPageState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PagesController.prototype, "publish", null);
__decorate([
    (0, common_1.Post)(':id/unpublish'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, platform_1.RequirePermission)('website.pages.publish'),
    (0, platform_1.Audit)({ category: 'website.pages', entityType: 'WebsitePage', action: 'update', fetchState: fetchPageState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PagesController.prototype, "unpublish", null);
__decorate([
    (0, common_1.Put)(':id/blocks'),
    (0, platform_1.RequirePermission)('website.pages.update'),
    (0, platform_1.Audit)({ category: 'website.pages', entityType: 'WebsitePage', action: 'update', fetchState: fetchPageState }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, replace_blocks_dto_1.ReplaceBlocksDto]),
    __metadata("design:returntype", Promise)
], PagesController.prototype, "replaceBlocks", null);
exports.PagesController = PagesController = __decorate([
    (0, common_1.Controller)('api/website/pages'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [pages_service_1.PagesService])
], PagesController);
