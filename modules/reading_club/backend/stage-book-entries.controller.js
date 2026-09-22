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
exports.StageBookEntriesController = void 0;
const common_1 = require("@nestjs/common");
const add_book_entry_dto_1 = require("./dto/add-book-entry.dto");
const discard_book_entry_dto_1 = require("./dto/discard-book-entry.dto");
const platform_1 = require("./platform");
const stage_book_entries_service_1 = require("./stage-book-entries.service");
const fetchEntryState = (prisma, req) => prisma.readingClubStageBookEntry.findUnique({ where: { id: req.params.entryId } });
/**
 * Per-stage book tracking (item D) — "books read this stage" list on a
 * reader's detail page. Gated by `reading_club.memberships.update_progress`
 * (READING_CLUB-D14: closest existing permission — "editing a reader's
 * stage-tracking data" — reused rather than inventing a new one) for every
 * mutating action; listing reuses the broader `.memberships.view` like the
 * rest of a reader's detail page.
 */
let StageBookEntriesController = class StageBookEntriesController {
    bookEntries;
    constructor(bookEntries) {
        this.bookEntries = bookEntries;
    }
    async list(studentId) {
        return this.bookEntries.listForReader(studentId);
    }
    async addManual(studentId, dto, user) {
        return this.bookEntries.addManual(studentId, dto, user.userId);
    }
    async discard(_studentId, entryId, dto, user) {
        return this.bookEntries.discard(entryId, dto, user.userId);
    }
    async remove(_studentId, entryId) {
        await this.bookEntries.remove(entryId);
    }
};
exports.StageBookEntriesController = StageBookEntriesController;
__decorate([
    (0, common_1.Get)(),
    (0, platform_1.RequirePermission)('reading_club.memberships.view'),
    __param(0, (0, common_1.Param)('studentId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StageBookEntriesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, platform_1.RequirePermission)('reading_club.memberships.update_progress'),
    (0, platform_1.Audit)({ category: 'reading_club.stage_book_entries', entityType: 'ReadingClubStageBookEntry', action: 'add_manual' }),
    __param(0, (0, common_1.Param)('studentId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, add_book_entry_dto_1.AddBookEntryDto, Object]),
    __metadata("design:returntype", Promise)
], StageBookEntriesController.prototype, "addManual", null);
__decorate([
    (0, common_1.Patch)(':entryId/discard'),
    (0, platform_1.RequirePermission)('reading_club.memberships.update_progress'),
    (0, platform_1.Audit)({
        category: 'reading_club.stage_book_entries',
        entityType: 'ReadingClubStageBookEntry',
        action: 'discard',
        fetchState: fetchEntryState,
    }),
    __param(0, (0, common_1.Param)('studentId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('entryId', new common_1.ParseUUIDPipe())),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, discard_book_entry_dto_1.DiscardBookEntryDto, Object]),
    __metadata("design:returntype", Promise)
], StageBookEntriesController.prototype, "discard", null);
__decorate([
    (0, common_1.Delete)(':entryId'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, platform_1.RequirePermission)('reading_club.memberships.update_progress'),
    (0, platform_1.Audit)({
        category: 'reading_club.stage_book_entries',
        entityType: 'ReadingClubStageBookEntry',
        action: 'delete',
        fetchState: fetchEntryState,
    }),
    __param(0, (0, common_1.Param)('studentId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Param)('entryId', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], StageBookEntriesController.prototype, "remove", null);
exports.StageBookEntriesController = StageBookEntriesController = __decorate([
    (0, common_1.Controller)('api/reading-club/readers/:studentId/book-entries'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [stage_book_entries_service_1.StageBookEntriesService])
], StageBookEntriesController);
