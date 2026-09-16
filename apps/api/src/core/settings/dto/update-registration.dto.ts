import { IsBoolean } from 'class-validator';

/** PUT /settings/registration body — the whole `users.allow_self_registration` value (D41). */
export class UpdateRegistrationDto {
  @IsBoolean()
  allowSelfRegistration!: boolean;
}
