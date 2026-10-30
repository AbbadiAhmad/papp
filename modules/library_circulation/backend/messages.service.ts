import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { MessageRecipientsDto, MessageTemplateDto, SendMessageDto } from './dto/message.dto';
import { NOTIFICATIONS_SENDER, NotificationsSender } from './notifications-sender';
import { StudentsService } from './students.service';

export const MESSAGE_TEMPLATES_KEY = 'library_circulation.message_templates';
export const MESSAGE_CATEGORY = 'library_circulation.message';

export interface MessageTemplate {
  id: string;
  name: string;
  title: string;
  bodyMarkdown: string;
}

interface Recipient {
  studentId: string;
  userId: string;
  name: string;
  code: string;
  className: string;
  /** Pre-formatted values for {{books}}, {{fines_total}}, {{days_late}}. */
  books: string;
  finesTotal: string;
  daysLate: string;
}

export interface MessagePreview {
  recipientCount: number;
  /** The first few names, so the librarian can sanity-check the selection. */
  sample: Array<{ code: string; name: string }>;
}

export interface MessageSendResult {
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  /** Only meaningful when email was requested. */
  emailedCount: number;
}

const OPEN_FINE_STATUSES = ['unpaid', 'partially_paid'];
const DAY_MS = 86_400_000;
const SAMPLE_SIZE = 10;

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Librarian-composed messages to readers (in-app notification, optionally
 * also emailed) with librarian-defined templates and rule-based recipients.
 * Each reader gets their OWN notification so per-reader placeholders work:
 * `{{name}}` (filled by the Notification Center itself) plus `{{code}}`,
 * `{{class}}`, `{{books}}` (their overdue books with due dates),
 * `{{fines_total}}` (what they still owe) and `{{days_late}}` (their longest
 * overdue book), all substituted here. Templates live in `system_settings`
 * (admin-tunable data, never a code constant). Whether email goes out is the
 * librarian's per-send choice and overrides the category's email setting.
 */
@Injectable()
export class MessagesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagesService.name);
  // The library catalog's staff-only internal notes (LIBRARY_CATALOG-D35) must never ride along in this module's responses.
  private readonly prisma = new PrismaClient({ omit: { libraryCatalogBook: { internalNote: true }, libraryCatalogBookCopy: { internalNote: true } } });

  constructor(
    private readonly students: StudentsService,
    @Inject(NOTIFICATIONS_SENDER) private readonly notifications: NotificationsSender,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // --- templates ------------------------------------------------------------

  async listTemplates(): Promise<MessageTemplate[]> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: MESSAGE_TEMPLATES_KEY } });
    return Array.isArray(row?.value) ? (row.value as unknown as MessageTemplate[]) : [];
  }

  /** Replaces the whole list (add / edit / delete are all one save). */
  async saveTemplates(templates: MessageTemplateDto[]): Promise<MessageTemplate[]> {
    const names = new Set<string>();
    const cleaned = templates.map((tpl) => {
      const name = tpl.name.trim();
      const key = name.toLowerCase();
      if (names.has(key)) throw new BadRequestException(`Duplicate template name "${name}"`);
      names.add(key);
      return { id: tpl.id?.trim() || randomUUID(), name, title: tpl.title, bodyMarkdown: tpl.bodyMarkdown };
    });
    await this.prisma.systemSetting.upsert({
      where: { key: MESSAGE_TEMPLATES_KEY },
      update: { value: cleaned as unknown as Prisma.InputJsonValue },
      create: { key: MESSAGE_TEMPLATES_KEY, value: cleaned as unknown as Prisma.InputJsonValue },
    });
    return cleaned;
  }

  // --- recipients -----------------------------------------------------------

  /** Typeahead for "individual readers" — same matching as the scan page's reader search. */
  searchReaders(q: string) {
    return this.students.search(q ?? '', 8);
  }

  private periodRange(dto: MessageRecipientsDto): { gte?: Date; lte?: Date } | undefined {
    const range: { gte?: Date; lte?: Date } = {};
    if (dto.dateFrom) range.gte = new Date(`${dto.dateFrom.slice(0, 10)}T00:00:00.000Z`);
    if (dto.dateTo) range.lte = new Date(`${dto.dateTo.slice(0, 10)}T23:59:59.999Z`);
    if (range.gte && range.lte && range.gte > range.lte) throw new BadRequestException('The period start is after its end');
    return range.gte || range.lte ? range : undefined;
  }

  /** Overdue = still out and past due ('overdue' is set lazily, so an 'active' loan past its date counts too). */
  private overdueWhere(now: Date, period?: { gte?: Date; lte?: Date }): Prisma.LibraryBorrowingWhereInput {
    return {
      returnedAt: null,
      OR: [{ status: 'overdue' }, { status: 'active', dueAt: { lt: now } }],
      ...(period ? { dueAt: { ...period, lt: now } } : {}),
    };
  }

  async resolveRecipients(dto: MessageRecipientsDto): Promise<Recipient[]> {
    const now = new Date();
    const period = this.periodRange(dto);
    // Only readers with an active account can be messaged.
    const everyone = (await this.students.list()).filter((s) => s.isActive);

    let chosen = everyone;
    let fineRows: Array<{ studentId: string; amount: Prisma.Decimal; amountPaid: Prisma.Decimal }> | null = null;
    let overdueRows: Array<{ studentId: string; bookCopyId: string; dueAt: Date }> | null = null;

    if (dto.mode === 'individual') {
      const wanted = new Set(dto.studentIds ?? []);
      if (wanted.size === 0) throw new BadRequestException('Pick at least one reader');
      chosen = everyone.filter((s) => wanted.has(s.id));
    } else if (dto.mode === 'unpaid_fines') {
      fineRows = await this.prisma.libraryFine.findMany({
        where: { status: { in: OPEN_FINE_STATUSES }, ...(period ? { createdAt: period } : {}) },
        select: { studentId: true, amount: true, amountPaid: true },
      });
      const ids = new Set(fineRows.map((f) => f.studentId));
      chosen = everyone.filter((s) => ids.has(s.id));
    } else if (dto.mode === 'overdue') {
      overdueRows = await this.prisma.libraryBorrowing.findMany({
        where: this.overdueWhere(now, period),
        select: { studentId: true, bookCopyId: true, dueAt: true },
      });
      const ids = new Set(overdueRows.map((b) => b.studentId));
      chosen = everyone.filter((s) => ids.has(s.id));
    }
    if (chosen.length === 0) return [];

    // Placeholder context. The rule that picked the readers also limits its own
    // figures (e.g. "fines created in March" -> only those fines are summed);
    // otherwise everything currently open for the chosen readers is used.
    const chosenIds = chosen.map((s) => s.id);
    fineRows ??= await this.prisma.libraryFine.findMany({
      where: { studentId: { in: chosenIds }, status: { in: OPEN_FINE_STATUSES } },
      select: { studentId: true, amount: true, amountPaid: true },
    });
    overdueRows ??= await this.prisma.libraryBorrowing.findMany({
      where: { studentId: { in: chosenIds }, ...this.overdueWhere(now) },
      select: { studentId: true, bookCopyId: true, dueAt: true },
    });

    const owed = new Map<string, number>();
    for (const f of fineRows) owed.set(f.studentId, (owed.get(f.studentId) ?? 0) + Number(f.amount) - Number(f.amountPaid));

    const copyIds = [...new Set(overdueRows.map((b) => b.bookCopyId))];
    const copies = copyIds.length ? await this.prisma.libraryCatalogBookCopy.findMany({ where: { id: { in: copyIds } } }) : [];
    const bookIds = [...new Set(copies.map((c) => c.bookId))];
    const books = bookIds.length ? await this.prisma.libraryCatalogBook.findMany({ where: { id: { in: bookIds } } }) : [];
    const titleByCopy = new Map(copies.map((c) => [c.id, books.find((b) => b.id === c.bookId)?.title ?? '']));
    const loansByStudent = new Map<string, Array<{ title: string; dueAt: Date }>>();
    for (const b of overdueRows) {
      const list = loansByStudent.get(b.studentId) ?? [];
      list.push({ title: titleByCopy.get(b.bookCopyId) ?? '', dueAt: b.dueAt });
      loansByStudent.set(b.studentId, list);
    }

    return chosen.map((s) => {
      const loans = (loansByStudent.get(s.id) ?? []).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      const daysLate = loans.length ? Math.max(...loans.map((l) => Math.floor((now.getTime() - l.dueAt.getTime()) / DAY_MS))) : 0;
      return {
        studentId: s.id,
        userId: s.userId,
        name: s.name ?? s.code,
        code: s.code,
        className: s.className ?? '',
        books: loans.map((l) => `- ${l.title} (${isoDate(l.dueAt)})`).join('\n'),
        finesTotal: Math.max(0, owed.get(s.id) ?? 0).toFixed(2),
        daysLate: String(Math.max(0, daysLate)),
      };
    });
  }

  async preview(dto: MessageRecipientsDto): Promise<MessagePreview> {
    const recipients = await this.resolveRecipients(dto);
    return { recipientCount: recipients.length, sample: recipients.slice(0, SAMPLE_SIZE).map((r) => ({ code: r.code, name: r.name })) };
  }

  // --- sending --------------------------------------------------------------

  /** `{{name}}` is intentionally left for the Notification Center's own per-recipient substitution. */
  static fill(text: string, r: Recipient): string {
    const values: Record<string, string> = { code: r.code, class: r.className, books: r.books, fines_total: r.finesTotal, days_late: r.daysLate };
    return text.replace(/\{\{\s*(code|class|books|fines_total|days_late)\s*\}\}/g, (_m, key: string) => values[key]);
  }

  async send(dto: SendMessageDto, sentBy: string): Promise<MessageSendResult> {
    const recipients = await this.resolveRecipients(dto.recipients);
    if (recipients.length === 0) throw new BadRequestException('No readers match the chosen recipients');

    const result: MessageSendResult = { recipientCount: recipients.length, sentCount: 0, failedCount: 0, emailedCount: 0 };
    for (const r of recipients) {
      try {
        const sent = (await this.notifications.send({
          category: MESSAGE_CATEGORY,
          title: MessagesService.fill(dto.title, r),
          bodyMarkdown: MessagesService.fill(dto.bodyMarkdown, r),
          targetType: 'user',
          targetId: r.userId,
          sentBy,
          email: dto.sendEmail,
        })) as { emailedCount?: number } | undefined;
        result.sentCount += 1;
        result.emailedCount += sent?.emailedCount ?? 0;
      } catch (error) {
        result.failedCount += 1;
        this.logger.error(`Message to reader ${r.code} failed`, error instanceof Error ? error.stack : String(error));
      }
    }
    return result;
  }
}
