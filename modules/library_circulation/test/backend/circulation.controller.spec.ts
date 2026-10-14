import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CirculationController } from '../../backend/circulation.controller';
import { computeLateFine } from '../../backend/settings.service';

/** The "return + paid now" orchestration lives in the controller (it spans the return and the finance permission). */
describe('CirculationController.returnBorrowing — fine paid now', () => {
  let circulation: Record<string, jest.Mock>;
  let fines: Record<string, jest.Mock>;
  let permissions: { getEffectivePermissionCodes: jest.Mock };
  let controller: CirculationController;
  const user = { userId: 'staff-1', sessionId: 's', email: 'a@b.test', mustChangePassword: false };
  const dtoWith = (fine: Record<string, unknown>) => ({ borrowingId: 'b-1', fine: { fineTypeId: 'ft-1', amount: 5, ...fine } });

  beforeEach(() => {
    circulation = {
      findBorrowing: jest.fn(async () => ({ id: 'b-1', studentId: 'r-1' })),
      returnBorrowing: jest.fn(async () => ({ borrowing: { id: 'b-1' }, daysLate: 0 })),
      getLoanPolicy: jest.fn(),
    };
    fines = {
      createWithOptionalPayment: jest.fn(async () => ({ fine: { id: 'f-1' }, payment: { receiptNumber: 'REC-1' }, paymentError: null })),
      createLateFine: jest.fn(),
    };
    permissions = { getEffectivePermissionCodes: jest.fn(async () => new Set(['library_circulation.return', 'library_circulation.finance.record_payment'])) };
    controller = new CirculationController(circulation as never, fines as never, {} as never, permissions);
  });

  it('records the fine and its payment in the same request when the caller may take payments', async () => {
    const result = await controller.returnBorrowing(dtoWith({ paid: true, paymentMethod: 'card' }) as never, user);

    expect(fines.createWithOptionalPayment).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'r-1', borrowingId: 'b-1', fineTypeId: 'ft-1', amount: 5 }),
      'staff-1',
      { method: 'card' },
    );
    expect(result).toMatchObject({ recordedFine: { id: 'f-1' }, finePayment: { receiptNumber: 'REC-1' }, finePaymentError: null });
  });

  it('paymentMethod defaults to cash', async () => {
    await controller.returnBorrowing(dtoWith({ paid: true }) as never, user);
    expect(fines.createWithOptionalPayment.mock.calls[0][2]).toEqual({ method: 'cash' });
  });

  it('refuses BEFORE recording the return when the caller lacks finance.record_payment', async () => {
    permissions.getEffectivePermissionCodes.mockResolvedValue(new Set(['library_circulation.return']));

    await expect(controller.returnBorrowing(dtoWith({ paid: true }) as never, user)).rejects.toBeInstanceOf(ForbiddenException);

    expect(circulation.returnBorrowing).not.toHaveBeenCalled();
    expect(fines.createWithOptionalPayment).not.toHaveBeenCalled();
  });

  it('an unpaid fine needs no extra permission and passes no payment', async () => {
    permissions.getEffectivePermissionCodes.mockResolvedValue(new Set(['library_circulation.return']));
    await controller.returnBorrowing(dtoWith({}) as never, user);
    expect(permissions.getEffectivePermissionCodes).not.toHaveBeenCalled();
    expect(fines.createWithOptionalPayment.mock.calls[0][2]).toBeNull();
  });
});

describe('computeLateFine (decimal rate, day/week unit, maximum fine)', () => {
  const day = { fineUnit: 'day' as const, maxFine: 0 };
  const week = { fineUnit: 'week' as const, maxFine: 0 };

  it('charges per day, allowing a decimal rate', () => {
    expect(computeLateFine(3, { finePerDay: 0.5, ...day })).toBe(1.5);
    expect(computeLateFine(10, { finePerDay: 0.25, ...day })).toBe(2.5);
    expect(computeLateFine(3, { finePerDay: 0.1, ...day })).toBe(0.3); // no 0.30000000000000004
  });

  it('charges per STARTED week when the unit is week', () => {
    expect(computeLateFine(1, { finePerDay: 2, ...week })).toBe(2);
    expect(computeLateFine(7, { finePerDay: 2, ...week })).toBe(2);
    expect(computeLateFine(8, { finePerDay: 2, ...week })).toBe(4);
    expect(computeLateFine(15, { finePerDay: 1.5, ...week })).toBe(4.5);
  });

  it('never exceeds the maximum fine; 0 means no limit', () => {
    expect(computeLateFine(100, { finePerDay: 1, fineUnit: 'day', maxFine: 20 })).toBe(20);
    expect(computeLateFine(5, { finePerDay: 1, fineUnit: 'day', maxFine: 20 })).toBe(5);
    expect(computeLateFine(100, { finePerDay: 1, ...day })).toBe(100);
  });

  it('is 0 when not late or when no rate is set', () => {
    expect(computeLateFine(0, { finePerDay: 1, ...day })).toBe(0);
    expect(computeLateFine(5, { finePerDay: 0, ...day })).toBe(0);
  });
});

describe('CirculationController.returnBorrowing — automatic late fine follows the policy', () => {
  it('creates the late fine with the weekly rate and the cap applied', async () => {
    const circulation = {
      findBorrowing: jest.fn(async () => ({ id: 'b-1', studentId: 'r-1' })),
      returnBorrowing: jest.fn(async () => ({ borrowing: { id: 'b-1' }, daysLate: 30 })),
      getLoanPolicy: jest.fn(async () => ({ finePerDay: 2.5, fineUnit: 'week', maxFine: 8 })),
    };
    const fines = { createLateFine: jest.fn(async () => ({ id: 'f-1' })) };
    const controller = new CirculationController(circulation as never, fines as never, {} as never, { getEffectivePermissionCodes: jest.fn() } as never);

    await controller.returnBorrowing({ borrowingId: 'b-1' } as never, { userId: 'staff-1', sessionId: 's', email: 'a@b.test', mustChangePassword: false });

    // 30 days = 5 started weeks x 2.5 = 12.5, capped at 8
    expect(fines.createLateFine).toHaveBeenCalledWith('r-1', 'b-1', 8, 'staff-1');
  });
});
