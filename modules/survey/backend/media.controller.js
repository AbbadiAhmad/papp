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
exports.SurveyMediaController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const media_rules_1 = require("./media-rules");
const media_service_1 = require("./media.service");
const platform_1 = require("./platform");
/**
 * Survey pictures (phase D, SURVEY-D18). Uploading needs the same permission as editing the
 * survey; viewing is public by an unguessable id (a respondent of a public survey is anonymous),
 * and the bytes are only ever served with the type recorded at upload, never sniffed by the browser.
 */
let SurveyMediaController = class SurveyMediaController {
    media;
    constructor(media) {
        this.media = media;
    }
    async upload(id, file, user) {
        if (!file)
            throw new common_1.BadRequestException('No image uploaded (expected multipart field "file")');
        return this.media.upload(id, file.buffer, user.userId);
    }
    async serve(mediaId, res) {
        const found = await this.media.locate(mediaId);
        if (!found)
            throw new common_1.NotFoundException('Image not found');
        res.set({
            'Content-Type': found.mime,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cross-Origin-Resource-Policy': 'cross-origin',
            // The id is never reused for different bytes, so the browser may keep it for good.
            'Cache-Control': 'public, max-age=31536000, immutable',
        });
        res.sendFile(found.path, (err) => {
            if (err && !res.headersSent)
                res.status(404).json({ statusCode: 404, message: 'Image not found' });
        });
    }
};
exports.SurveyMediaController = SurveyMediaController;
__decorate([
    (0, common_1.Post)('surveys/:id/media'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.UseGuards)(platform_1.MustChangePasswordGuard),
    (0, platform_1.RequirePermission)('survey.surveys.update'),
    (0, platform_1.Audit)({ category: 'survey.surveys', entityType: 'SurveyMedia', action: 'upload_image' })
    // +1 so an oversize file reaches the service's own, clearer message instead of a generic 413.
    ,
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: media_rules_1.MAX_IMAGE_BYTES + 1 } })),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, platform_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], SurveyMediaController.prototype, "upload", null);
__decorate([
    (0, common_1.Get)('media/:mediaId'),
    (0, platform_1.Public)(),
    __param(0, (0, common_1.Param)('mediaId', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SurveyMediaController.prototype, "serve", null);
exports.SurveyMediaController = SurveyMediaController = __decorate([
    (0, common_1.Controller)('api/survey'),
    __metadata("design:paramtypes", [media_service_1.SurveyMediaService])
], SurveyMediaController);
