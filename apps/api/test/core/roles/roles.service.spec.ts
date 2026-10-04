import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { RolesService } from '../../../src/core/roles/roles.service';
import { UpdateRoleDto } from '../../../src/core/roles/dto/update-role.dto';

interface MockPrisma {
  role: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
  };
  userRole: {
    upsert: jest.Mock;
    deleteMany: jest.Mock;
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
  $executeRaw: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    role: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    user: { findUnique: jest.fn() },
    userRole: { upsert: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
    // Real RolesService code only ever calls tx.$executeRaw (the advisory
    // lock)/tx.userRole.findMany/tx.userRole.deleteMany inside the
    // callback — handing back the SAME mock object as `tx` is enough here,
    // matching the pattern already established in auth.service.spec.ts.
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    $executeRaw: jest.fn().mockResolvedValue(undefined),
  };
  return prisma;
}

function roleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'role-1',
    code: 'custom_role',
    nameI18nKey: 'roles.custom_role',
    isSystem: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('RolesService', () => {
  let prisma: MockPrisma;
  let service: RolesService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new RolesService(prisma as never);
  });

  describe('findByCode', () => {
    it('returns the role when the code exists', async () => {
      prisma.role.findUnique.mockResolvedValue(roleRow({ code: 'member' }));

      await expect(service.findByCode('member')).resolves.toEqual(expect.objectContaining({ code: 'member' }));
      expect(prisma.role.findUnique).toHaveBeenCalledWith({ where: { code: 'member' } });
    });

    it('returns null (not a throw) when the code does not exist', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.findByCode('no_such_role')).resolves.toBeNull();
    });
  });

  describe('remove', () => {
    it('rejects deleting a system role with ForbiddenException and never touches delete', async () => {
      prisma.role.findUnique.mockResolvedValue(roleRow({ code: 'admin', isSystem: true }));

      await expect(service.remove('role-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.role.delete).not.toHaveBeenCalled();
    });

    it('deletes a custom (non-system) role', async () => {
      prisma.role.findUnique.mockResolvedValue(roleRow({ isSystem: false }));
      prisma.role.delete.mockResolvedValue(roleRow());

      await expect(service.remove('role-1')).resolves.toBeUndefined();
      expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'role-1' } });
    });

    it('throws NotFoundException for an unknown role id', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.role.delete).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('patches ONLY nameI18nKey — code and isSystem are immutable through the API', async () => {
      prisma.role.findUnique.mockResolvedValue(roleRow());
      prisma.role.update.mockResolvedValue(roleRow({ nameI18nKey: 'roles.renamed' }));

      // Even a hostile dto smuggling extra properties must not reach the DB
      // write — the service hand-picks nameI18nKey, nothing else.
      const dto = { nameI18nKey: 'roles.renamed', code: 'evil_new_code', isSystem: true } as UpdateRoleDto;
      const result = await service.update('role-1', dto);

      expect(prisma.role.update).toHaveBeenCalledWith({
        where: { id: 'role-1' },
        data: { nameI18nKey: 'roles.renamed' },
      });
      expect(result.nameI18nKey).toBe('roles.renamed');
    });

    it('throws NotFoundException before writing when the role does not exist', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { nameI18nKey: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.role.update).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('always creates with isSystem: false regardless of input', async () => {
      prisma.role.create.mockResolvedValue(roleRow());

      await service.create({ code: 'custom_role', nameI18nKey: 'roles.custom_role' });

      expect(prisma.role.create).toHaveBeenCalledWith({
        data: { code: 'custom_role', nameI18nKey: 'roles.custom_role', isSystem: false },
      });
    });
  });

  describe('assignToUser', () => {
    it('upserts the user_roles row (idempotent) with assignedBy recorded on create only', async () => {
      prisma.role.findUnique.mockResolvedValue(roleRow());
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.userRole.upsert.mockResolvedValue({});

      await service.assignToUser('role-1', 'user-1', 'admin-1');

      expect(prisma.userRole.upsert).toHaveBeenCalledWith({
        where: { userId_roleId: { userId: 'user-1', roleId: 'role-1' } },
        update: {},
        create: { userId: 'user-1', roleId: 'role-1', assignedBy: 'admin-1' },
      });
    });

    it('throws NotFoundException for an unknown role before touching user_roles', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.assignToUser('missing', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.userRole.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown user before touching user_roles', async () => {
      prisma.role.findUnique.mockResolvedValue(roleRow());
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.assignToUser('role-1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.userRole.upsert).not.toHaveBeenCalled();
    });
  });

  describe('unassignFromUser', () => {
    it('deletes by the userId+roleId pair and is a no-op when nothing matches (non-admin role: no transaction/lock needed)', async () => {
      prisma.role.findUnique.mockResolvedValue(roleRow({ code: 'custom_role' }));
      prisma.userRole.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.unassignFromUser('role-1', 'user-1')).resolves.toBeUndefined();
      expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', roleId: 'role-1' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown role before attempting any delete', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.unassignFromUser('missing', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
    });

    describe('when unassigning the admin role — last-active-admin guard', () => {
      it('rejects with ForbiddenException when the target user is the ONLY active admin, and deletes nothing', async () => {
        prisma.role.findUnique.mockResolvedValue(roleRow({ id: 'role-admin', code: 'admin' }));
        prisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }]);

        await expect(service.unassignFromUser('role-admin', 'user-1')).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      });

      it('succeeds when at least one OTHER active admin remains', async () => {
        prisma.role.findUnique.mockResolvedValue(roleRow({ id: 'role-admin', code: 'admin' }));
        prisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);
        prisma.userRole.deleteMany.mockResolvedValue({ count: 1 });

        await expect(service.unassignFromUser('role-admin', 'user-1')).resolves.toBeUndefined();
        expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', roleId: 'role-admin' } });
      });

      it('is a no-op (never throws) when the target user does not even hold admin — nothing to unassign, nothing to orphan', async () => {
        prisma.role.findUnique.mockResolvedValue(roleRow({ id: 'role-admin', code: 'admin' }));
        prisma.userRole.findMany.mockResolvedValue([{ userId: 'someone-else' }]);
        prisma.userRole.deleteMany.mockResolvedValue({ count: 0 });

        await expect(service.unassignFromUser('role-admin', 'user-1')).resolves.toBeUndefined();
      });
    });
  });

  describe('assertNotLastActiveAdmin', () => {
    it('takes the advisory lock BEFORE counting admins', async () => {
      const callOrder: string[] = [];
      prisma.$executeRaw.mockImplementation(() => {
        callOrder.push('lock');
        return Promise.resolve(undefined);
      });
      prisma.userRole.findMany.mockImplementation(() => {
        callOrder.push('count');
        return Promise.resolve([{ userId: 'user-1' }, { userId: 'user-2' }]);
      });

      await service.assertNotLastActiveAdmin(prisma as never, 'user-1');

      expect(callOrder).toEqual(['lock', 'count']);
    });

    it('only counts admins where user.isActive is true (queried via the join filter)', async () => {
      prisma.userRole.findMany.mockResolvedValue([{ userId: 'user-2' }]);

      await service.assertNotLastActiveAdmin(prisma as never, 'user-1');

      expect(prisma.userRole.findMany).toHaveBeenCalledWith({
        where: { role: { code: 'admin' }, user: { isActive: true } },
        select: { userId: true },
      });
    });

    it('does not throw for a candidate who never held admin in the first place', async () => {
      prisma.userRole.findMany.mockResolvedValue([{ userId: 'user-2' }, { userId: 'user-3' }]);

      await expect(service.assertNotLastActiveAdmin(prisma as never, 'user-1')).resolves.toBeUndefined();
    });
  });
});
