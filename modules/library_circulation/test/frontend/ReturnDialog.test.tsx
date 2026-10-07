import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import circulationEn from '../../locales/en.json';

const api = vi.hoisted(() => ({ listFineTypes: vi.fn() }));
const auth = vi.hoisted(() => ({ canPay: true }));

vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), libraryCirculationApi: api }));
vi.mock('../../../../apps/web/src/app/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (code: string) => (code === 'library_circulation.finance.record_payment' ? auth.canPay : true) }),
}));

import { ReturnDialog } from '../../frontend/pages/ReturnDialog';

const TYPES = [
  { id: 'ft-late', code: 'FINE-LATE', name: 'Late return', defaultAmount: '0', isActive: true },
  { id: 'ft-damage', code: 'FINE-DAMAGE', name: 'Damaged book', defaultAmount: '10', isActive: true },
];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const borrowing = (dueDaysAgo: number) => ({
  id: 'b1', bookCopyId: 'c1', studentId: 'r1', status: 'active', borrowedAt: daysAgo(dueDaysAgo + 14), dueAt: daysAgo(dueDaysAgo), returnedAt: null, borrowedBy: 's', returnedBy: null,
});

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', circulationEn, true, true);
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  vi.clearAllMocks();
  auth.canPay = true;
  api.listFineTypes.mockResolvedValue(TYPES);
});

function open(b: ReturnType<typeof borrowing>, onReturn = vi.fn(async () => undefined), finePerDay = 2) {
  render(<ReturnDialog open borrowing={b as never} bookLabel="Dune" finePerDay={finePerDay} onReturn={onReturn} onClose={vi.fn()} />);
  return onReturn;
}

describe('ReturnDialog fine payment', () => {
  it('a late return starts with the late fine added (days late x daily rate), paid now in cash', async () => {
    const onReturn = open(borrowing(3));
    await waitFor(() => expect(screen.getByLabelText('Paid now')).toBeChecked());
    await waitFor(() => expect(screen.getByDisplayValue('6')).toBeInTheDocument()); // 3 days x 2

    fireEvent.click(screen.getByRole('button', { name: 'Complete return' }));

    await waitFor(() => expect(onReturn).toHaveBeenCalled());
    const [, , , fine] = onReturn.mock.calls[0] as unknown[];
    expect(fine).toMatchObject({ fineTypeId: 'ft-late', amount: 6, paid: true, paymentMethod: 'cash' });
  });

  it('unticking "Paid now" records the fine as unpaid (no paid flag sent)', async () => {
    const onReturn = open(borrowing(3));
    fireEvent.click(await screen.findByLabelText('Paid now'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete return' }));

    await waitFor(() => expect(onReturn).toHaveBeenCalled());
    const fine = (onReturn.mock.calls[0] as unknown[])[3] as Record<string, unknown>;
    expect(fine).toMatchObject({ amount: 6 });
    expect(fine.paid).toBeUndefined();
  });

  it('without the record-payment permission the option is hidden and the fine is created unpaid', async () => {
    auth.canPay = false;
    const onReturn = open(borrowing(3));
    await screen.findByLabelText('Add a fine for this return');
    expect(screen.queryByLabelText('Paid now')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Complete return' }));
    await waitFor(() => expect(onReturn).toHaveBeenCalled());
    expect(((onReturn.mock.calls[0] as unknown[])[3] as Record<string, unknown>).paid).toBeUndefined();
  });

  it('an on-time return adds no fine by default', async () => {
    const onReturn = open({ ...borrowing(-5) });
    await screen.findByLabelText('Add a fine for this return');
    expect(screen.getByLabelText('Add a fine for this return')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Complete return' }));
    await waitFor(() => expect(onReturn).toHaveBeenCalled());
    expect((onReturn.mock.calls[0] as unknown[])[3]).toBeUndefined();
  });
});
