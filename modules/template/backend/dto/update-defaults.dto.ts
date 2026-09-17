import { IsIn } from 'class-validator';
import { TEMPLATE_ITEM_STATUSES, type TemplateItemStatusValue } from './create-item.dto';

/**
 * The shape of the `template.defaults` module setting (manifest.json
 * `settings[0]`, docs/MODULE_SPEC.md §8) — demonstrated end-to-end: seeded
 * on install, read by `ItemsService.create` when a caller omits `status`,
 * and editable through `SettingsController` below.
 */
export class UpdateDefaultsDto {
  @IsIn(TEMPLATE_ITEM_STATUSES)
  defaultStatus!: TemplateItemStatusValue;
}
