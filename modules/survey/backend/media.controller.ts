import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { MAX_IMAGE_BYTES } from './media-rules';
import { SurveyMediaService } from './media.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, Public, RequirePermission } from './platform';

/**
 * Survey pictures (phase D, SURVEY-D18). Uploading needs the same permission as editing the
 * survey; viewing is public by an unguessable id (a respondent of a public survey is anonymous),
 * and the bytes are only ever served with the type recorded at upload, never sniffed by the browser.
 */
@Controller('api/survey')
export class SurveyMediaController {
  constructor(private readonly media: SurveyMediaService) {}

  @Post('surveys/:id/media')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(MustChangePasswordGuard)
  @RequirePermission('survey.surveys.update')
  @Audit({ category: 'survey.surveys', entityType: 'SurveyMedia', action: 'upload_image' })
  // +1 so an oversize file reaches the service's own, clearer message instead of a generic 413.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES + 1 } }))
  async upload(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException('No image uploaded (expected multipart field "file")');
    return this.media.upload(id, file.buffer, user.userId);
  }

  @Get('media/:mediaId')
  @Public()
  async serve(@Param('mediaId', new ParseUUIDPipe()) mediaId: string, @Res() res: Response) {
    const found = await this.media.locate(mediaId);
    if (!found) throw new NotFoundException('Image not found');
    res.set({
      'Content-Type': found.mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      // The id is never reused for different bytes, so the browser may keep it for good.
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.sendFile(found.path, (err) => {
      if (err && !res.headersSent) res.status(404).json({ statusCode: 404, message: 'Image not found' });
    });
  }
}
