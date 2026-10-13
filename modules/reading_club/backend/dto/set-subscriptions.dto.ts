import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

/** The caller's full desired set of subscribed event types (validated against the known list in the service). */
export class SetSubscriptionsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  eventTypes!: string[];
}
