"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var PagesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const create_page_dto_1 = require("./dto/create-page.dto");
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
/**
 * Pages + their ordered blocks. Own dedicated `PrismaClient` (D57 pattern,
 * same as every other module).
 */
let PagesService = PagesService_1 = class PagesService {
    logger = new common_1.Logger(PagesService_1.name);
    prisma = new client_1.PrismaClient();
    async onModuleInit() {
        await this.prisma.$connect();
        this.logger.log('website (pages) Prisma client connected');
    }
    async onModuleDestroy() {
        await this.prisma.$disconnect();
    }
    async list() {
        return this.prisma.websitePage.findMany({ orderBy: { createdAt: 'desc' } });
    }
    async findById(id) {
        const page = await this.getOrThrow(id);
        const blocks = await this.prisma.websiteBlock.findMany({ where: { pageId: id }, orderBy: { orderIndex: 'asc' } });
        return { ...page, blocks };
    }
    async create(dto) {
        this.assertSlugNotReserved(dto.slug);
        try {
            return await this.prisma.websitePage.create({
                data: { slug: dto.slug, title: dto.title, status: dto.status ?? 'draft' },
            });
        }
        catch (error) {
            throw this.translateUniqueConstraintError(error);
        }
    }
    async update(id, dto) {
        await this.getOrThrow(id);
        if (dto.slug !== undefined)
            this.assertSlugNotReserved(dto.slug);
        try {
            if (dto.isHomepage === true) {
                // At most one homepage (partial unique index) — clear the previous one first, in the same transaction.
                return await this.prisma.$transaction(async (tx) => {
                    await tx.websitePage.updateMany({ where: { isHomepage: true, NOT: { id } }, data: { isHomepage: false } });
                    return tx.websitePage.update({
                        where: { id },
                        data: { slug: dto.slug, title: dto.title, isHomepage: true },
                    });
                });
            }
            return await this.prisma.websitePage.update({
                where: { id },
                data: { slug: dto.slug, title: dto.title, isHomepage: dto.isHomepage },
            });
        }
        catch (error) {
            throw this.translateUniqueConstraintError(error);
        }
    }
    async remove(id) {
        await this.getOrThrow(id);
        await this.prisma.websitePage.delete({ where: { id } }); // cascades to blocks
    }
    async publish(id) {
        await this.getOrThrow(id);
        return this.prisma.websitePage.update({ where: { id }, data: { status: 'published' } });
    }
    async unpublish(id) {
        await this.getOrThrow(id);
        return this.prisma.websitePage.update({ where: { id }, data: { status: 'draft' } });
    }
    /** Whole-block-list replace-by-id (upsert-by-id so unmodified blocks keep their id; an omitted block is deleted) — same pattern as survey's structure endpoint. */
    async replaceBlocks(pageId, blocks) {
        await this.getOrThrow(pageId);
        return this.prisma.$transaction(async (tx) => {
            const keepIds = blocks.map((b) => b.id);
            // D66's own lesson: an empty keep-list can't use `notIn: []` against a UUID column — use a conditional where instead.
            if (keepIds.length > 0) {
                await tx.websiteBlock.deleteMany({ where: { pageId, id: { notIn: keepIds } } });
            }
            else {
                await tx.websiteBlock.deleteMany({ where: { pageId } });
            }
            for (const block of blocks) {
                await tx.websiteBlock.upsert({
                    where: { id: block.id },
                    update: { orderIndex: block.orderIndex, type: block.type, config: block.config },
                    create: {
                        id: block.id,
                        pageId,
                        orderIndex: block.orderIndex,
                        type: block.type,
                        config: block.config,
                    },
                });
            }
            return tx.websiteBlock.findMany({ where: { pageId }, orderBy: { orderIndex: 'asc' } });
        });
    }
    async findPublicBySlug(slug) {
        const page = await this.prisma.websitePage.findUnique({ where: { slug } });
        if (!page || page.status !== 'published') {
            throw new common_1.NotFoundException('Page not found');
        }
        const blocks = await this.prisma.websiteBlock.findMany({ where: { pageId: page.id }, orderBy: { orderIndex: 'asc' } });
        return { ...page, blocks };
    }
    async findPublicHomepage() {
        const page = await this.prisma.websitePage.findFirst({ where: { isHomepage: true, status: 'published' } });
        if (!page) {
            throw new common_1.NotFoundException('No published homepage is set');
        }
        const blocks = await this.prisma.websiteBlock.findMany({ where: { pageId: page.id }, orderBy: { orderIndex: 'asc' } });
        return { ...page, blocks };
    }
    // --- internals ---------------------------------------------------------
    assertSlugNotReserved(slug) {
        if (create_page_dto_1.RESERVED_SLUGS.includes(slug)) {
            throw new common_1.ConflictException(`"${slug}" is a reserved slug (shadowed by the admin routes) — choose another.`);
        }
    }
    async getOrThrow(id) {
        const page = await this.prisma.websitePage.findUnique({ where: { id } });
        if (!page)
            throw new common_1.NotFoundException('Page not found');
        return page;
    }
    translateUniqueConstraintError(error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
            const target = error.meta?.target?.join(', ') ?? 'field';
            return new common_1.ConflictException(`A page with this ${target} already exists`);
        }
        return error;
    }
};
exports.PagesService = PagesService;
exports.PagesService = PagesService = PagesService_1 = __decorate([
    (0, common_1.Injectable)()
], PagesService);
