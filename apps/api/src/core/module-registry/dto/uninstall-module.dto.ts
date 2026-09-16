import { IsBoolean, IsOptional } from 'class-validator';

/**
 * D26 / MODULE_SPEC.md §5: uninstall is safe-by-default. `dropData: true` is
 * an explicit, separate confirmation to also run the module's own
 * down-migrations (if it ships any under `migrations/down/`) — never implied
 * by a bare uninstall call.
 */
export class UninstallModuleDto {
  @IsOptional()
  @IsBoolean()
  dropData?: boolean;
}
