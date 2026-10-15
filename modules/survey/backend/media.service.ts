import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
  collectMediaIds,
  extensionForMime,
  ImageMime,
  MAX_IMAGES_PER_SURVEY,
  validateImageUpload,
} from './media-rules';

/** Pictures not referenced by the survey are kept this long (an upload happens before the Save click). */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;

/**
 * Stores survey pictures in a disk volume (SURVEY-D18). Files are named `<media id>.<ext>`; the
 * `survey_media` row is the ownership/type record, so a file name or type is never taken from the
 * request. Real `PrismaClient`, same module-boundary reason as SurveysService.
 */
@Injectable()
export class SurveyMediaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SurveyMediaService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /** Read on every call so a deployment (and a test) can point it elsewhere. */
  directory(): string {
    return process.env.SURVEY_MEDIA_DIR || join(process.cwd(), 'data', 'survey-media');
  }

  private fileFor(id: string, mime: string): string {
    return join(this.directory(), `${id}.${extensionForMime(mime as ImageMime)}`);
  }

  async upload(surveyId: string, bytes: Uint8Array | undefined, userId: string | null) {
    const survey = await this.prisma.surveySurvey.findUnique({ where: { id: surveyId }, select: { id: true } });
    if (!survey) throw new NotFoundException('Survey not found');
    const checked = validateImageUpload(bytes);
    if ('error' in checked) throw new BadRequestException(checked.error);
    const count = await this.prisma.surveyMedia.count({ where: { surveyId } });
    if (count >= MAX_IMAGES_PER_SURVEY) {
      throw new BadRequestException(`A survey can hold at most ${MAX_IMAGES_PER_SURVEY} images`);
    }
    const id = randomUUID();
    await fs.mkdir(this.directory(), { recursive: true });
    await fs.writeFile(this.fileFor(id, checked.mime), bytes as Uint8Array);
    try {
      await this.prisma.surveyMedia.create({ data: { id, surveyId, mime: checked.mime, sizeBytes: bytes!.length, createdBy: userId } });
    } catch (err) {
      await fs.rm(this.fileFor(id, checked.mime), { force: true });
      throw err;
    }
    return { mediaId: id, mime: checked.mime, sizeBytes: bytes!.length };
  }

  /** For the public image route: where the file is and its type, from the DB row only. */
  async locate(id: string): Promise<{ path: string; mime: string } | null> {
    const row = await this.prisma.surveyMedia.findUnique({ where: { id } });
    return row ? { path: this.fileFor(row.id, row.mime), mime: row.mime } : null;
  }

  /** Rejects a save that references a picture belonging to another survey (or none at all). */
  async assertOwned(surveyId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.prisma.surveyMedia.count({ where: { surveyId, id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException('An image used in this survey was not found; upload it again');
  }

  /** Deletes this survey's pictures that nothing references any more (and are not brand new). */
  async collectGarbage(surveyId: string): Promise<void> {
    try {
      const survey = await this.prisma.surveySurvey.findUnique({
        where: { id: surveyId },
        include: { sections: { include: { questions: { select: { config: true } } } } },
      });
      if (!survey) return;
      const settings = (survey.settings ?? {}) as Record<string, unknown>;
      const referenced = new Set(
        collectMediaIds({
          headerImage: settings.headerImage,
          sections: survey.sections.map((s) => ({
            image: s.image,
            questions: s.questions.map((q) => ({ config: (q.config ?? {}) as Record<string, unknown> })),
          })),
        }),
      );
      const rows = await this.prisma.surveyMedia.findMany({
        where: { surveyId, createdAt: { lt: new Date(Date.now() - ORPHAN_GRACE_MS) } },
      });
      for (const row of rows.filter((r) => !referenced.has(r.id))) {
        await this.prisma.surveyMedia.delete({ where: { id: row.id } });
        await fs.rm(this.fileFor(row.id, row.mime), { force: true });
      }
    } catch (err) {
      // Cleanup must never fail the save that triggered it.
      this.logger.warn(`image cleanup failed: ${(err as Error).message}`);
    }
  }

  /** Lists a survey's pictures (id + type), used before deleting a survey so the files can follow. */
  async listFor(surveyId: string) {
    return this.prisma.surveyMedia.findMany({ where: { surveyId } });
  }

  async removeFiles(rows: Array<{ id: string; mime: string }>): Promise<void> {
    for (const row of rows) await fs.rm(this.fileFor(row.id, row.mime), { force: true });
  }

  async readBytes(row: { id: string; mime: string }): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.fileFor(row.id, row.mime));
    } catch {
      return null;
    }
  }

  /**
   * Writes already-validated bytes as a new picture of `surveyId` (import / duplicate). The row is
   * created through `tx` so it commits or rolls back with the new survey; the caller removes the
   * returned files if the transaction fails.
   */
  async insertCopy(tx: Prisma.TransactionClient, surveyId: string, bytes: Uint8Array, createdBy: string | null) {
    const checked = validateImageUpload(bytes);
    if ('error' in checked) throw new BadRequestException(checked.error);
    const id = randomUUID();
    await fs.mkdir(this.directory(), { recursive: true });
    await fs.writeFile(this.fileFor(id, checked.mime), bytes);
    await tx.surveyMedia.create({ data: { id, surveyId, mime: checked.mime, sizeBytes: bytes.length, createdBy } });
    return { id, mime: checked.mime };
  }
}
