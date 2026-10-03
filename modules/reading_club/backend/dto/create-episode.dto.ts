import { IsString, MinLength } from 'class-validator';

/** Starting a new episode closes whatever was previously current (see EpisodesService.createEpisode). */
export class CreateEpisodeDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
