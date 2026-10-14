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
exports.MessagesController = void 0;
const common_1 = require("@nestjs/common");
const message_dto_1 = require("./dto/message.dto");
const messages_service_1 = require("./messages.service");
const platform_1 = require("./platform");
/**
 * Librarian -> reader messages. Sending and reading templates need
 * `messages.send`; changing the template list needs `messages.templates`.
 */
let MessagesController = class MessagesController {
    messages;
    constructor(messages) {
        this.messages = messages;
    }
    async listTemplates() {
        return this.messages.listTemplates();
    }
    async saveTemplates(dto) {
        return this.messages.saveTemplates(dto.templates);
    }
    async searchReaders(q) {
        return this.messages.searchReaders(q ?? '');
    }
    /** Who a send would reach — writes nothing. */
    async preview(dto) {
        return this.messages.preview(dto.recipients);
    }
    async send(dto, user) {
        return this.messages.send(dto, user.userId);
    }
};
exports.MessagesController = MessagesController;
__decorate([
    (0, common_1.Get)('templates'),
    (0, platform_1.RequirePermission)('library_circulation.messages.send'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "listTemplates", null);
__decorate([
    (0, common_1.Put)('templates'),
    (0, platform_1.RequirePermission)('library_circulation.messages.templates'),
    (0, platform_1.Audit)({ category: 'library_circulation.messages', entityType: 'SystemSetting', action: 'update' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [message_dto_1.SaveMessageTemplatesDto]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "saveTemplates", null);
__decorate([
    (0, common_1.Get)('readers/search'),
    (0, platform_1.RequirePermission)('library_circulation.messages.send'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "searchReaders", null);
__decorate([
    (0, common_1.Post)('preview'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, platform_1.RequirePermission)('library_circulation.messages.send'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [message_dto_1.PreviewMessageDto]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "preview", null);
__decorate([
    (0, common_1.Post)('send'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, platform_1.RequirePermission)('library_circulation.messages.send'),
    (0, platform_1.Audit)({ category: 'library_circulation.messages', entityType: 'ReaderMessage', action: 'create' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [message_dto_1.SendMessageDto, Object]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "send", null);
exports.MessagesController = MessagesController = __decorate([
    (0, common_1.Controller)('api/library-circulation/messages'),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    __metadata("design:paramtypes", [messages_service_1.MessagesService])
], MessagesController);
