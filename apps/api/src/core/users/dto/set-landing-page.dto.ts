import { IsString, ValidateIf } from 'class-validator';

/**
 * Body of `PATCH /users/me/landing-page`. `landingPage: null` resets to the
 * platform default; any other value must be one of the routes
 * `UsersService.listLandingPageOptions()` currently offers this caller — the
 * service re-validates it, this DTO only enforces the JSON shape (a string
 * when not explicitly null, never left undefined).
 */
export class SetLandingPageDto {
  @ValidateIf((dto: SetLandingPageDto) => dto.landingPage !== null)
  @IsString()
  landingPage!: string | null;
}
