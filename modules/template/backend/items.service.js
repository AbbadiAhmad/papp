"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var ItemsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ItemsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const settings_service_1 = require("./settings.service");
/**
 * Own dedicated `PrismaClient` (D57 pattern — see any other module's own
 * service docblock for the full rationale): never core's `PrismaService`
 * directly, a real hoisted `@prisma/client` npm package instead.
 */
let ItemsService = ItemsService_1 = class ItemsService {
    logger = new common_1.Logger(ItemsService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('template Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async list() {
        return this.prisma.templateItem.findMany({ orderBy: { createdAt: 'desc' } });
    }
    async findById(id) {
        return this.getOrThrow(id);
    }
    async create(dto, ownerUserId) {
        const status = dto.status ?? (await this.readDefaultStatus());
        return this.prisma.templateItem.create({
            data: { title: dto.title, description: dto.description, status, ownerUserId },
        });
    }
    async update(id, dto) {
        await this.getOrThrow(id);
        return this.prisma.templateItem.update({
            where: { id },
            data: { title: dto.title, description: dto.description, status: dto.status },
        });
    }
    async remove(id) {
        await this.getOrThrow(id);
        await this.prisma.templateItem.delete({ where: { id } });
    }
    /** Used by the public route — never exposes `ownerUserId`, and only for a currently-`active` item. */
    async getPublicIfActive(id) {
        const item = await this.prisma.templateItem.findUnique({ where: { id } });
        if (!item || item.status !== 'active') {
            throw new common_1.NotFoundException('Item not found');
        }
        return { id: item.id, title: item.title, description: item.description };
    }
    // --- internals -------------------------------------------------------
    async getOrThrow(id) {
        const item = await this.prisma.templateItem.findUnique({ where: { id } });
        if (!item) {
            throw new common_1.NotFoundException('Item not found');
        }
        return item;
    }
    /**
     * Reads the module's own `template.defaults` setting directly off
     * `system_settings` (the SAME table core's cached `SettingsService` reads
     * — modules don't get a separate settings store, just their own
     * namespaced keys, docs/MODULE_SPEC.md §8.2) via this module's own Prisma
     * client (that table's model is part of the one shared schema every
     * module's generated client already includes). No caching layer here on
     * purpose — this is a template, not a proof that every module needs
     * core's exact caching strategy; a real module reading its settings often
     * enough to matter should add its own cache.
     */
    async readDefaultStatus() {
        const row = await this.prisma.systemSetting.findUnique({ where: { key: settings_service_1.TEMPLATE_DEFAULTS_KEY } });
        const value = row?.value;
        return value?.defaultStatus === 'archived' ? 'archived' : settings_service_1.DEFAULT_STATUS_FALLBACK;
    }
};
exports.ItemsService = ItemsService;
exports.ItemsService = ItemsService = ItemsService_1 = __decorate([
    (0, common_1.Injectable)()
], ItemsService);
