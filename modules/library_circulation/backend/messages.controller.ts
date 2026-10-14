import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PreviewMessageDto, SaveMessageTemplatesDto, SendMessageDto } from './dto/message.dto';
import { MessagesService } from './messages.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

/**
 * Librarian -> reader messages. Sending and reading templates need
 * `messages.send`; changing the template list needs `messages.templates`.
 */
@Controller('api/library-circulation/messages')
@UseGuards(MustChangePasswordGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('templates')
  @RequirePermission('library_circulation.messages.send')
  async listTemplates() {
    return this.messages.listTemplates();
  }

  @Put('templates')
  @RequirePermission('library_circulation.messages.templates')
  @Audit({ category: 'library_circulation.messages', entityType: 'SystemSetting', action: 'update' })
  async saveTemplates(@Body() dto: SaveMessageTemplatesDto) {
    return this.messages.saveTemplates(dto.templates);
  }

  @Get('readers/search')
  @RequirePermission('library_circulation.messages.send')
  async searchReaders(@Query('q') q: string) {
    return this.messages.searchReaders(q ?? '');
  }

  /** Who a send would reach — writes nothing. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('library_circulation.messages.send')
  async preview(@Body() dto: PreviewMessageDto) {
    return this.messages.preview(dto.recipients);
  }

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('library_circulation.messages.send')
  @Audit({ category: 'library_circulation.messages', entityType: 'ReaderMessage', action: 'create' })
  async send(@Body() dto: SendMessageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.messages.send(dto, user.userId);
  }
}
