/**
 * Club event types + a structural publisher interface/token, used by
 * `groups`/`memberships`/`stage-completions`/`episodes` services to announce
 * what happened WITHOUT depending on how subscribers are notified. Same
 * token+interface pattern as `notifications-sender.ts` (root D74): the
 * services stay trivially unit-testable, and the publisher is an OPTIONAL
 * dependency (`@Optional()`), so a service built without it simply emits
 * nothing.
 */
export const CLUB_EVENT_TYPES = [
  'reader_added',
  'reader_removed',
  'reader_moved',
  'stage_completed',
  'reward_given',
  'group_created',
  'group_updated',
  'group_deleted',
  'stage_created',
  'stage_updated',
  'stage_deleted',
  'episode_started',
  'episode_deleted',
] as const;

export type ClubEventType = (typeof CLUB_EVENT_TYPES)[number];

export interface ClubEvent {
  type: ClubEventType;
  /** The reader (library_students.id) the event is about, when it is about one. */
  studentId?: string;
  /** Free human-readable detail line (group/stage/episode name, reward...). */
  details?: string;
}

export const CLUB_EVENT_PUBLISHER = Symbol('CLUB_EVENT_PUBLISHER');

export interface ClubEventPublisher {
  /** Never throws — a notification failure must not fail the underlying action. */
  publish(event: ClubEvent): Promise<void>;
}
