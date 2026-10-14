import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { EpisodesService } from './episodes.service';
import { MembershipsService } from './memberships.service';

/** Same string as library_circulation's `READER_IMPORT_EXTENSION` (plain string so neither module imports the other). */
export const READER_IMPORT_EXTENSION = 'papp.library_circulation.reader_import_extension';

/** Same rules as the import's matching: ignore case, extra spaces, Arabic diacritics/tatweel and alef/yaa/taa-marbuta spelling variants. */
export function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

interface ClubRow {
  row: number;
  club: boolean | null;
  clubGroup: string | null;
  clubStage: string | null;
}

/**
 * Club columns of library_circulation's readers import. Always targets the
 * CURRENT episode (the file never names one). Rules per row:
 *  - Club = no            -> remove the reader from the club (no-op if not a member)
 *  - Club Group given     -> member of that group (implies Club = yes); the
 *                            stage is matched by name or order number, blank = group's first stage
 *  - Club = yes, no group -> only valid for a reader who is already a member (no change)
 * An unchanged group+stage never resets a reader's progress.
 */
@Injectable()
export class ReaderImportService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  constructor(
    private readonly episodes: EpisodesService,
    private readonly memberships: MembershipsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private async resolve(row: ClubRow, episodeId: string): Promise<{ error?: string; groupId?: string; stageId?: string | null }> {
    if (!row.clubGroup) return {};
    const groups = await this.prisma.readingClubGroup.findMany({ where: { episodeId, isActive: true }, orderBy: { name: 'asc' } });
    const wantedGroup = normalizeName(row.clubGroup);
    const matches = groups.filter((g) => normalizeName(g.name) === wantedGroup);
    if (matches.length === 0) {
      return { error: `Club group "${row.clubGroup}" not found in the current episode. Available groups: ${groups.map((g) => g.name).join(', ') || '(none)'}` };
    }
    if (matches.length > 1) return { error: `Club group "${row.clubGroup}" is ambiguous — ${matches.length} groups share that name` };
    const group = matches[0];
    if (!row.clubStage) return { groupId: group.id, stageId: null };
    const stages = await this.prisma.readingClubStage.findMany({ where: { groupId: group.id }, orderBy: { stageOrder: 'asc' } });
    const wanted = normalizeName(row.clubStage);
    const stage = stages.find((s) => normalizeName(s.name) === wanted) ?? (/^\d+$/.test(wanted) ? stages.find((s) => s.stageOrder === Number(wanted)) : undefined);
    if (!stage) {
      return { error: `Club stage "${row.clubStage}" not found in group "${group.name}". Available stages: ${stages.map((s) => s.name).join(', ') || '(none)'}` };
    }
    return { groupId: group.id, stageId: stage.id };
  }

  /** Current members + the valid group/stage names, for the readers export (see library_circulation's reader-import-extension.ts). */
  async exportData(studentIds: string[]): Promise<{
    members: Record<string, { group: string | null; stage: string | null }>;
    groups: Array<{ name: string; stages: Array<{ order: number; name: string }> }>;
  }> {
    const episode = await this.episodes.findCurrentEpisodeOrNull();
    if (!episode) return { members: {}, groups: [] };
    const groups = await this.prisma.readingClubGroup.findMany({
      where: { episodeId: episode.id, isActive: true },
      orderBy: { name: 'asc' },
      include: { stages: { orderBy: { stageOrder: 'asc' } } },
    });
    const memberships = studentIds.length
      ? await this.prisma.readingClubMembership.findMany({ where: { episodeId: episode.id, studentId: { in: studentIds } } })
      : [];
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const members: Record<string, { group: string | null; stage: string | null }> = {};
    for (const m of memberships) {
      const group = m.groupId ? groupById.get(m.groupId) : undefined;
      const stage = group?.stages.find((st) => st.id === m.currentStageId);
      // Live names when the group/stage still exists, else the snapshot taken at assignment.
      members[m.studentId] = { group: group?.name ?? m.groupName ?? null, stage: stage?.name ?? m.stageName ?? null };
    }
    return {
      members,
      groups: groups.map((g) => ({ name: g.name, stages: g.stages.map((st) => ({ order: st.stageOrder, name: st.name })) })),
    };
  }

  async validate(rows: ClubRow[]): Promise<Array<{ row: number; error: string }>> {
    const withData = rows.filter((r) => r.club !== null || r.clubGroup || r.clubStage);
    if (withData.length === 0) return [];
    const episode = await this.episodes.findCurrentEpisodeOrNull();
    if (!episode) return withData.map((r) => ({ row: r.row, error: 'No current reading-club episode — start one first' }));

    const errors: Array<{ row: number; error: string }> = [];
    for (const r of withData) {
      if (r.club === false && (r.clubGroup || r.clubStage)) {
        errors.push({ row: r.row, error: 'Club is "no" but a club group/stage was given' });
      } else if (r.clubStage && !r.clubGroup) {
        errors.push({ row: r.row, error: 'Club Stage needs a Club Group' });
      } else if (r.club === true && !r.clubGroup) {
        // Allowed only for existing members; that depends on the reader, checked at apply time.
        continue;
      } else {
        const resolved = await this.resolve(r, episode.id);
        if (resolved.error) errors.push({ row: r.row, error: resolved.error });
      }
    }
    return errors;
  }

  async apply(entries: Array<ClubRow & { studentId: string }>, actorId: string): Promise<void> {
    const episode = await this.episodes.findCurrentEpisodeOrNull();
    if (!episode) return;
    for (const entry of entries) {
      if (entry.club === null && !entry.clubGroup) continue;
      const existing = await this.prisma.readingClubMembership.findUnique({ where: { studentId: entry.studentId } });
      if (entry.club === false) {
        if (existing && existing.episodeId === episode.id) await this.memberships.removeMembership(entry.studentId);
        continue;
      }
      if (!entry.clubGroup) continue; // "yes" with no group: nothing to change
      const { groupId, stageId } = await this.resolve(entry, episode.id);
      if (!groupId) continue;

      const sameGroup = existing?.episodeId === episode.id && existing.groupId === groupId;
      if (!sameGroup) {
        await this.memberships.assign({ studentId: entry.studentId, groupId, stageId: stageId ?? undefined }, actorId);
      } else if (stageId && existing.currentStageId !== stageId) {
        await this.memberships.moveStage(entry.studentId, { stageId });
      }
    }
  }
}
