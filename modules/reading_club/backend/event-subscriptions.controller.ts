import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { ClubEventsService } from './club-events.service';
import { SetSubscriptionsDto } from './dto/set-subscriptions.dto';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

const fetchMySubscriptions = async (prisma: PrismaClient, req: Request) => {
  const userId = (req as Request & { user?: AuthenticatedUser }).user?.userId;
  if (!userId) return null;
  const rows = await prisma.readingClubEventSubscription.findMany({ where: { userId }, orderBy: { eventType: 'asc' } });
  return { eventTypes: rows.map((r) => r.eventType) };
};

/** A user manages only THEIR OWN subscriptions — there is no way to read or change another user's. */
@Controller('api/reading-club/event-subscriptions')
@UseGuards(MustChangePasswordGuard)
export class EventSubscriptionsController {
  constructor(private readonly events: ClubEventsService) {}

  @Get('me')
  @RequirePermission('reading_club.notifications.subscribe')
  async getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.events.getMySubscriptions(user.userId);
  }

  @Put('me')
  @RequirePermission('reading_club.notifications.subscribe')
  @Audit({ category: 'reading_club.notifications', entityType: 'ReadingClubEventSubscription', action: 'update', fetchState: fetchMySubscriptions })
  async setMine(@Body() dto: SetSubscriptionsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.events.setMySubscriptions(user.userId, dto.eventTypes);
  }
}
