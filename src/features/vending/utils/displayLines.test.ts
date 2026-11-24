import { describe, expect, it } from 'vitest';
import type { PaymentRequest, PaymentState } from '@/features/payments';
import { displayLines, shownCode } from './displayLines';

const request: PaymentRequest = {
  spot: 'pro',
  productCode: '21',
  amountCents: 160,
  label: '21 · Cola',
};

describe('displayLines', () => {
  it('asks for a code when idle and empty', () => {
    expect(displayLines({ status: 'idle' }, '', null)).toEqual(['Enter', 'the code']);
  });

  it('asks for the second digit after the first one', () => {
    expect(displayLines({ status: 'idle' }, '2', null)).toEqual(['2nd digit', '']);
  });

  it('shows the keypad error while idle', () => {
    expect(displayLines({ status: 'idle' }, '', 'Sold out')).toEqual(['Sold out', 'Try another']);
  });

  it('shows the price while waiting for the tap', () => {
    const state: PaymentState = { status: 'waiting_tap', request, paymentId: 'p1' };
    expect(displayLines(state, '21', null)[1]).toBe('Pay →');
  });

  it('names the failure reason', () => {
    const state: PaymentState = { status: 'failed', request, reason: 'timeout' };
    expect(displayLines(state, '', null)).toEqual(['Timed out', 'Try again']);
  });
});

describe('shownCode', () => {
  it('shows a placeholder, a cursor, then the full code', () => {
    expect(shownCode('')).toBe('— —');
    expect(shownCode('2')).toBe('2_');
    expect(shownCode('21')).toBe('21');
  });
});
