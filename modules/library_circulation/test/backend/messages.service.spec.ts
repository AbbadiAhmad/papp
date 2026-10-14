import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MessagesService } from '../../backend/messages.service';

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const reader = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: `u-${id}`,
  code: `R-${id}`,
  name: `Reader ${id}`,
  className: '5A',
  isActive: true,
  ...over,
});

function build() {
  const students = { list: jest.fn(async (): Promise<unknown[]> => []), search: jest.fn() };
  const notifications = { send: jest.fn(async (): Promise<unknown> => ({ emailedCount: 1 })) };
  const prisma = {
    libraryFine: { findMany: jest.fn(async (): Promise<unknown[]> => []) },
    libraryBorrowing: { findMany: jest.fn(async (): Promise<unknown[]> => []) },
    libraryCatalogBookCopy: { findMany: jest.fn(async (): Promise<unknown[]> => []) },
    libraryCatalogBook: { findMany: jest.fn(async (): Promise<unknown[]> => []) },
    systemSetting: { findUnique: jest.fn(async (): Promise<unknown> => null), upsert: jest.fn(async () => undefined) },
  };
  const service = new MessagesService(students as never, notifications as never);
  (service as unknown as { prisma: unknown }).prisma = prisma;
  return { service, students, notifications, prisma };
}

describe('MessagesService', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
    ctx.students.list.mockResolvedValue([reader('1'), reader('2'), reader('3', { isActive: false })]);
  });

  describe('recipients', () => {
    it('all: every ACTIVE reader (inactive accounts cannot be messaged)', async () => {
      const r = await ctx.service.resolveRecipients({ mode: 'all' });
      expect(r.map((x) => x.studentId)).toEqual(['1', '2']);
    });

    it('individual: only the chosen readers; none chosen is a 400', async () => {
      const r = await ctx.service.resolveRecipients({ mode: 'individual', studentIds: ['2', '3'] });
      expect(r.map((x) => x.studentId)).toEqual(['2']); // 3 is inactive
      await expect(ctx.service.resolveRecipients({ mode: 'individual', studentIds: [] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('unpaid_fines: readers with unpaid/partially paid fines in the period, with what they still owe', async () => {
      ctx.prisma.libraryFine.findMany.mockResolvedValue([
        { studentId: '1', amount: 10, amountPaid: 4 },
        { studentId: '1', amount: 5, amountPaid: 0 },
      ]);
      const r = await ctx.service.resolveRecipients({ mode: 'unpaid_fines', dateFrom: '2026-03-01', dateTo: '2026-03-31' });
      expect(r.map((x) => x.studentId)).toEqual(['1']);
      expect(r[0].finesTotal).toBe('11.00');
      const where = (ctx.prisma.libraryFine.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
      expect(where.status).toEqual({ in: ['unpaid', 'partially_paid'] });
      expect(where.createdAt).toEqual({ gte: new Date('2026-03-01T00:00:00.000Z'), lte: new Date('2026-03-31T23:59:59.999Z') });
    });

    it('overdue: readers with a late book in the due-date period, with book list and days late', async () => {
      ctx.prisma.libraryBorrowing.findMany.mockResolvedValue([
        { studentId: '2', bookCopyId: 'c1', dueAt: daysAgo(10) },
        { studentId: '2', bookCopyId: 'c2', dueAt: daysAgo(3) },
      ]);
      ctx.prisma.libraryCatalogBookCopy.findMany.mockResolvedValue([{ id: 'c1', bookId: 'b1' }, { id: 'c2', bookId: 'b2' }]);
      ctx.prisma.libraryCatalogBook.findMany.mockResolvedValue([{ id: 'b1', title: 'Kalila' }, { id: 'b2', title: 'Sindbad' }]);

      const r = await ctx.service.resolveRecipients({ mode: 'overdue', dateTo: '2099-01-01' });
      expect(r.map((x) => x.studentId)).toEqual(['2']);
      expect(r[0].daysLate).toBe('10');
      expect(r[0].books.split('\n')).toHaveLength(2);
      expect(r[0].books).toContain('- Kalila (');
      const where = (ctx.prisma.libraryBorrowing.findMany.mock.calls[0] as unknown as [{ where: { dueAt?: unknown; returnedAt: unknown } }])[0].where;
      expect(where.returnedAt).toBeNull();
      expect(where.dueAt).toMatchObject({ lte: new Date('2099-01-01T23:59:59.999Z') });
    });

    it('rejects a period whose start is after its end', async () => {
      await expect(ctx.service.resolveRecipients({ mode: 'overdue', dateFrom: '2026-05-02', dateTo: '2026-05-01' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('send', () => {
    it('sends one notification per reader with per-reader placeholders, honouring the email choice', async () => {
      await ctx.service.send(
        { recipients: { mode: 'all' }, title: 'Hi {{name}} ({{code}})', bodyMarkdown: 'Class {{class}} / {{ fines_total }}', sendEmail: true },
        'staff-1',
      );
      expect(ctx.notifications.send).toHaveBeenCalledTimes(2);
      expect(ctx.notifications.send).toHaveBeenNthCalledWith(1, {
        category: 'library_circulation.message',
        title: 'Hi {{name}} (R-1)', // {{name}} is left for the Notification Center
        bodyMarkdown: 'Class 5A / 0.00',
        targetType: 'user',
        targetId: 'u-1',
        sentBy: 'staff-1',
        email: true,
      });
    });

    it('email off is passed as an explicit false (overrides a category that has email on)', async () => {
      await ctx.service.send({ recipients: { mode: 'all' }, title: 't', bodyMarkdown: 'b', sendEmail: false }, 's');
      expect((ctx.notifications.send.mock.calls[0] as unknown as [{ email: boolean }])[0].email).toBe(false);
    });

    it('counts sent / failed / emailed and keeps going after one failure', async () => {
      ctx.notifications.send.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ emailedCount: 1 });
      const result = await ctx.service.send({ recipients: { mode: 'all' }, title: 't', bodyMarkdown: 'b', sendEmail: true }, 's');
      expect(result).toEqual({ recipientCount: 2, sentCount: 1, failedCount: 1, emailedCount: 1 });
    });

    it('refuses to send when nobody matches', async () => {
      await expect(ctx.service.send({ recipients: { mode: 'unpaid_fines' }, title: 't', bodyMarkdown: 'b', sendEmail: false }, 's')).rejects.toBeInstanceOf(BadRequestException);
      expect(ctx.notifications.send).not.toHaveBeenCalled();
    });
  });

  describe('templates', () => {
    it('lists [] when nothing is stored, saves with generated ids, and rejects duplicate names', async () => {
      expect(await ctx.service.listTemplates()).toEqual([]);
      const saved = await ctx.service.saveTemplates([{ name: ' Overdue ', title: 't', bodyMarkdown: 'b' }, { id: 'keep', name: 'Fine', title: 't', bodyMarkdown: 'b' }]);
      expect(saved[0].id).toMatch(/[0-9a-f-]{36}/);
      expect(saved[0].name).toBe('Overdue');
      expect(saved[1].id).toBe('keep');
      expect(ctx.prisma.systemSetting.upsert).toHaveBeenCalled();
      await expect(ctx.service.saveTemplates([{ name: 'A', title: 't', bodyMarkdown: 'b' }, { name: 'a', title: 't', bodyMarkdown: 'b' }])).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
