"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLUB_EVENT_PUBLISHER = exports.CLUB_EVENT_TYPES = void 0;
/**
 * Club event types + a structural publisher interface/token, used by
 * `groups`/`memberships`/`stage-completions`/`episodes` services to announce
 * what happened WITHOUT depending on how subscribers are notified. Same
 * token+interface pattern as `notifications-sender.ts` (root D74): the
 * services stay trivially unit-testable, and the publisher is an OPTIONAL
 * dependency (`@Optional()`), so a service built without it simply emits
 * nothing.
 */
exports.CLUB_EVENT_TYPES = [
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
];
exports.CLUB_EVENT_PUBLISHER = Symbol('CLUB_EVENT_PUBLISHER');
