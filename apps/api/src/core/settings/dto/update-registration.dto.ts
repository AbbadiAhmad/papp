import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * PUT /settings/registration body — `users.allow_self_registration` plus
 * (new) `users.self_registration_role_code`, the role self-registered
 * accounts are assigned. `selfRegistrationRoleCode` is optional on the
 * wire (omit to leave it unchanged) but, once provided, must be a real
 * role code — checked against the `roles` table in the service layer
 * (DTO-level validation can't see the DB), never trusted as-is.
 */
export class UpdateRegistrationDto {
  @IsBoolean()
  allowSelfRegistration!: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  selfRegistrationRoleCode?: string;
}
