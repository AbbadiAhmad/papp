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
exports.SaveMessageTemplatesDto = exports.MessageTemplateDto = exports.SendMessageDto = exports.PreviewMessageDto = exports.MessageRecipientsDto = exports.MESSAGE_RECIPIENT_MODES = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
exports.MESSAGE_RECIPIENT_MODES = ['all', 'individual', 'unpaid_fines', 'overdue'];
/**
 * Who a message goes to. `unpaid_fines`: readers with an unpaid/partially
 * paid fine (period = the fine's creation date). `overdue`: readers with a
 * book still out past its due date (period = the due date). Both periods
 * are optional, inclusive and date-only.
 */
class MessageRecipientsDto {
    mode;
    studentIds;
    dateFrom;
    dateTo;
}
exports.MessageRecipientsDto = MessageRecipientsDto;
__decorate([
    (0, class_validator_1.IsIn)(exports.MESSAGE_RECIPIENT_MODES),
    __metadata("design:type", String)
], MessageRecipientsDto.prototype, "mode", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(1000),
    (0, class_validator_1.IsUUID)('all', { each: true }),
    __metadata("design:type", Array)
], MessageRecipientsDto.prototype, "studentIds", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], MessageRecipientsDto.prototype, "dateFrom", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], MessageRecipientsDto.prototype, "dateTo", void 0);
class PreviewMessageDto {
    recipients;
}
exports.PreviewMessageDto = PreviewMessageDto;
__decorate([
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => MessageRecipientsDto),
    __metadata("design:type", MessageRecipientsDto)
], PreviewMessageDto.prototype, "recipients", void 0);
class SendMessageDto extends PreviewMessageDto {
    title;
    bodyMarkdown;
    /** false = in-app notification only; true = also email each reader. */
    sendEmail;
}
exports.SendMessageDto = SendMessageDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], SendMessageDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(5000),
    __metadata("design:type", String)
], SendMessageDto.prototype, "bodyMarkdown", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], SendMessageDto.prototype, "sendEmail", void 0);
class MessageTemplateDto {
    /** Omitted for a new template — assigned server-side. */
    id;
    name;
    title;
    bodyMarkdown;
}
exports.MessageTemplateDto = MessageTemplateDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], MessageTemplateDto.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], MessageTemplateDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], MessageTemplateDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(5000),
    __metadata("design:type", String)
], MessageTemplateDto.prototype, "bodyMarkdown", void 0);
class SaveMessageTemplatesDto {
    templates;
}
exports.SaveMessageTemplatesDto = SaveMessageTemplatesDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(50),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => MessageTemplateDto),
    __metadata("design:type", Array)
], SaveMessageTemplatesDto.prototype, "templates", void 0);
