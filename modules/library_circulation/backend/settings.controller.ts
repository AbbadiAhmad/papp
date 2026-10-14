import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { UpdateLoanPolicyDto } from './dto/update-loan-policy.dto';
import { UpdateReaderCardDto } from './dto/update-reader-card.dto';
import { Audit, MustChangePasswordGuard, RequirePermission } from './platform';
import { SettingsService } from './settings.service';

@Controller('api/library-circulation/settings')
@UseGuards(MustChangePasswordGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('loan-policy')
  @RequirePermission('library_circulation.settings.update')
  async getLoanPolicy() {
    return this.settings.getLoanPolicy();
  }

  @Put('loan-policy')
  @RequirePermission('library_circulation.settings.update')
  @Audit({ category: 'library_circulation.settings', entityType: 'SystemSetting', action: 'update' })
  async updateLoanPolicy(@Body() dto: UpdateLoanPolicyDto) {
    return this.settings.updateLoanPolicy(dto);
  }

  /** Text printed on reader ID cards — readable by whoever may print cards. */
  @Get('reader-card')
  @RequirePermission('library_circulation.students.print_cards')
  async getReaderCard() {
    return this.settings.getReaderCard();
  }

  @Put('reader-card')
  @RequirePermission('library_circulation.settings.update')
  @Audit({ category: 'library_circulation.settings', entityType: 'SystemSetting', action: 'update' })
  async updateReaderCard(@Body() dto: UpdateReaderCardDto) {
    return this.settings.updateReaderCard(dto);
  }
}
