import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
// eslint-disable-next-line import/no-unresolved
import { NotificationEmailService } from '../../../apps/api/dist/core/notifications/notification-email.service';
import { MAX_INVITES_PER_REQUEST, parseEmailList } from './email-list';
import { appPublicUrl, buildInviteMail, inviteLink, readInviteToken } from './invitations';
import { toPlainText } from './rich-text';
import { normalizeSettings } from './survey-settings';

/** A person is reminded at most once per day. */
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface AudienceCaller {
  userId?: string | null;
  inviteToken?: string | null;
}

export interface AudienceDecision {
  /** Which door was used; `invitation` carries the row to mark as opened/answered. */
  via: 'open' | 'user' | 'invitation';
  invitationId?: string;
}

/**
 * Who may respond (SURVEY-D22). A survey that is not restricted is open to anyone its other settings allow. A
 * restricted one accepts: a logged-in user on its allowed list; the holder of a genuine personal invitation link
 * whose invitation still exists; or a logged-in user whose account email matches an invitation. Own PrismaClient.
 */
@Injectable()
export class AudienceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AudienceService.name);
  private readonly prisma = new PrismaClient();

  constructor(private readonly mail: NotificationEmailService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // --- the gate used by the respondent paths -------------------------------

  async check(survey: { id: string; settings: unknown }, caller: AudienceCaller): Promise<AudienceDecision> {
    if (normalizeSettings(survey.settings).restricted !== true) return { via: 'open' };

    const invitationId = readInviteToken(caller.inviteToken);
    if (invitationId) {
      const row = await this.prisma.surveyInvitation.findFirst({ where: { id: invitationId, surveyId: survey.id } });
      if (row) return { via: 'invitation', invitationId: row.id };
    }
    if (caller.userId) {
      if ((await this.prisma.surveyAllowedUser.count({ where: { surveyId: survey.id, userId: caller.userId } })) > 0) return { via: 'user' };
      const rows = await this.prisma.$queryRaw<Array<{ email: string }>>`SELECT lower(email) AS email FROM users WHERE id = ${caller.userId}::uuid`;
      if (rows[0]) {
        const byEmail = await this.prisma.surveyInvitation.findFirst({ where: { surveyId: survey.id, email: rows[0].email } });
        if (byEmail) return { via: 'invitation', invitationId: byEmail.id };
      }
    }
    throw new ForbiddenException({ statusCode: 403, message: 'This survey is by invitation only', restricted: true });
  }

  async markOpened(invitationId: string): Promise<void> {
    await this.prisma.surveyInvitation.updateMany({ where: { id: invitationId, openedAt: null }, data: { openedAt: new Date() } });
  }

  /** Inside the response transaction: claim the invitation; false when it was already used (one answer per invitation). */
  async claimInvitation(tx: Pick<PrismaClient, 'surveyInvitation'>, invitationId: string): Promise<boolean> {
    const claimed = await tx.surveyInvitation.updateMany({ where: { id: invitationId, respondedAt: null }, data: { respondedAt: new Date() } });
    return claimed.count === 1;
  }

  async invitationEmail(invitationId: string): Promise<string | null> {
    return (await this.prisma.surveyInvitation.findUnique({ where: { id: invitationId }, select: { email: true } }))?.email ?? null;
  }

  // --- management ---------------------------------------------------------

  private async surveyOrThrow(surveyId: string) {
    const survey = await this.prisma.surveySurvey.findUnique({ where: { id: surveyId } });
    if (!survey) throw new NotFoundException('Survey not found');
    return survey;
  }

  async getAudience(surveyId: string) {
    const survey = await this.surveyOrThrow(surveyId);
    const [allowed, invitations] = await Promise.all([
      this.prisma.surveyAllowedUser.findMany({ where: { surveyId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.surveyInvitation.findMany({ where: { surveyId }, orderBy: { invitedAt: 'asc' } }),
    ]);
    const users = allowed.length
      ? await this.prisma.$queryRaw<Array<{ id: string; email: string; name: string }>>`SELECT id, email, name FROM users WHERE id = ANY(${allowed.map((a) => a.userId)}::uuid[])`
      : [];
    return {
      restricted: normalizeSettings(survey.settings).restricted === true,
      allowedUsers: allowed.map((a) => {
        const u = users.find((x) => x.id === a.userId);
        return { userId: a.userId, email: u?.email ?? '', name: u?.name || (u?.email ?? '') };
      }),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        status: i.respondedAt ? 'responded' : i.openedAt ? 'opened' : 'invited',
        invitedAt: i.invitedAt,
        openedAt: i.openedAt,
        respondedAt: i.respondedAt,
        lastReminderAt: i.lastReminderAt,
        reminderCount: i.reminderCount,
      })),
    };
  }

  async addAllowedUser(surveyId: string, email: string, addedBy: string) {
    await this.surveyOrThrow(surveyId);
    const found = await this.prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE lower(email) = lower(${email.trim()}) AND is_active = true LIMIT 1`;
    if (found.length === 0) throw new NotFoundException('No active user has that email address');
    await this.prisma.surveyAllowedUser.upsert({
      where: { surveyId_userId: { surveyId, userId: found[0].id } },
      create: { surveyId, userId: found[0].id, addedBy },
      update: {},
    });
    return { userId: found[0].id };
  }

  async removeAllowedUser(surveyId: string, userId: string) {
    await this.surveyOrThrow(surveyId);
    await this.prisma.surveyAllowedUser.deleteMany({ where: { surveyId, userId } });
    return { userId };
  }

  private requireSendable(survey: { status: string; archivedAt: Date | null }): string {
    if (survey.status !== 'published' || survey.archivedAt) throw new ConflictException('Publish the survey before sending invitations');
    const base = appPublicUrl();
    if (!base) throw new ConflictException('APP_PUBLIC_URL is not set on the server, so invitation links cannot be built');
    return base;
  }

  /** Creates invitations for the new addresses and emails each their personal link. Existing addresses are left alone. */
  async invite(surveyId: string, rawEmails: string[], invitedBy: string) {
    const survey = await this.surveyOrThrow(surveyId);
    const base = this.requireSendable(survey);
    const parsed = parseEmailList(rawEmails.join('\n'));
    if (parsed.valid.length === 0) throw new BadRequestException('No valid email address was given');
    if (parsed.valid.length > MAX_INVITES_PER_REQUEST) throw new BadRequestException(`At most ${MAX_INVITES_PER_REQUEST} invitations can be sent at once`);

    const existing = new Set((await this.prisma.surveyInvitation.findMany({ where: { surveyId, email: { in: parsed.valid } }, select: { email: true } })).map((r) => r.email));
    const fresh = parsed.valid.filter((e) => !existing.has(e));
    let sent = 0;
    let failed = 0;
    for (const email of fresh) {
      const row = await this.prisma.surveyInvitation.create({ data: { surveyId, email, invitedBy } });
      const ok = await this.mail.send({ to: email, ...buildInviteMail({ title: toPlainText(survey.title), link: inviteLink(base, surveyId, row.id), reminder: false, closesAt: survey.closesAt }) });
      if (ok) sent += 1;
      else failed += 1;
    }
    return { invited: fresh.length, alreadyInvited: parsed.valid.length - fresh.length, invalid: parsed.invalid, sent, failed };
  }

  /** Reminds everyone who has not answered (and was not already reminded in the last 24 hours). */
  async remind(surveyId: string) {
    const survey = await this.surveyOrThrow(surveyId);
    const base = this.requireSendable(survey);
    const cutoff = new Date(Date.now() - REMINDER_COOLDOWN_MS);
    const due = await this.prisma.surveyInvitation.findMany({
      where: { surveyId, respondedAt: null, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: cutoff } }] },
    });
    let sent = 0;
    let failed = 0;
    for (const row of due) {
      const ok = await this.mail.send({ to: row.email, ...buildInviteMail({ title: toPlainText(survey.title), link: inviteLink(base, surveyId, row.id), reminder: true, closesAt: survey.closesAt }) });
      if (ok) {
        sent += 1;
        await this.prisma.surveyInvitation.update({ where: { id: row.id }, data: { lastReminderAt: new Date(), reminderCount: { increment: 1 } } });
      } else {
        failed += 1;
      }
    }
    return { reminded: sent, failed, skipped: (await this.prisma.surveyInvitation.count({ where: { surveyId, respondedAt: null } })) - due.length };
  }

  async removeInvitation(surveyId: string, invitationId: string) {
    await this.surveyOrThrow(surveyId);
    await this.prisma.surveyInvitation.deleteMany({ where: { id: invitationId, surveyId } });
    return { invitationId };
  }
}
