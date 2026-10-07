import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CirculationController } from '../../backend/circulation.controller';

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
