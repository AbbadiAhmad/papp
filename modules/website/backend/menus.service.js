"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var MenusService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MenusService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const LOCATIONS = ['header', 'footer'];
/** Header/footer navigation menus for the public site. Own dedicated `PrismaClient` (D57 pattern). */
let MenusService = MenusService_1 = class MenusService {
    logger = new common_1.Logger(MenusService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('website (menus) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async list(location) {
        return this.prisma.websiteMenuItem.findMany({ where: { location }, orderBy: { orderIndex: 'asc' } });
    }
    async listPublic(location) {
        return this.list(location);
    }
    /** Whole-list replace-by-id for one location — same pattern as `PagesService.replaceBlocks`. */
    async replace(location, items) {
        return this.prisma.$transaction(async (tx) => {
            const keepIds = items.map((i) => i.id);
            if (keepIds.length > 0) {
                await tx.websiteMenuItem.deleteMany({ where: { location, id: { notIn: keepIds } } });
            }
            else {
                await tx.websiteMenuItem.deleteMany({ where: { location } });
            }
            for (const item of items) {
                await tx.websiteMenuItem.upsert({
                    where: { id: item.id },
                    update: { label: item.label, urlOrSlug: item.urlOrSlug, orderIndex: item.orderIndex, parentId: item.parentId },
                    create: {
                        id: item.id,
                        location,
                        label: item.label,
                        urlOrSlug: item.urlOrSlug,
                        orderIndex: item.orderIndex,
                        parentId: item.parentId,
                    },
                });
            }
            return tx.websiteMenuItem.findMany({ where: { location }, orderBy: { orderIndex: 'asc' } });
        });
    }
};
exports.MenusService = MenusService;
exports.MenusService = MenusService = MenusService_1 = __decorate([
    (0, common_1.Injectable)()
], MenusService);
