import { describe, expect, it, vi } from 'vitest';
import {
  initialPaymentState,
  paymentReducer,
  type PaymentAction,
  type PaymentState,
} from './machine';
import { MockGateway } from '../api/mock/mockGateway';
import type { PaymentEvent, PaymentRequest } from './types';

const request: PaymentRequest = {
  spot: 'pro',
  productCode: '21',
  amountCents: 160,
  label: '21 · Cola',
};
const run = (...actions: PaymentAction[]) =>
  actions.reduce<PaymentState>(paymentReducer, initialPaymentState);

describe('paymentReducer', () => {
  it('walks the happy path from request to delivered', () => {
    const state = run(
      { type: 'REQUEST', request },
      { type: 'STARTED', paymentId: 'p1' },
      { type: 'EVENT', event: { type: 'authorising', paymentId: 'p1' } },
      {
        type: 'EVENT',
        event: { type: 'approved', paymentId: 'p1', authCode: 'A1', method: 'card' },
      },
      { type: 'EVENT', event: { type: 'dispense', paymentId: 'p1', productCode: '21' } },
      { type: 'DISPENSE_DONE' },
    );
    expect(state).toMatchObject({ status: 'delivered', paymentId: 'p1', authCode: 'A1' });
  });

  it('ignores events for another payment', () => {
    const state = run(
      { type: 'REQUEST', request },
      { type: 'STARTED', paymentId: 'p1' },
      {
        type: 'EVENT',
        event: { type: 'approved', paymentId: 'other', authCode: 'X', method: 'card' },
      },
    );
    expect(state.status).toBe('waiting_tap');
  });

  it('does not let a late event reopen a finished payment', () => {
    const state = run(
      { type: 'REQUEST', request },
      { type: 'STARTED', paymentId: 'p1' },
      { type: 'EVENT', event: { type: 'failed', paymentId: 'p1', reason: 'cancelled' } },
      {
        type: 'EVENT',
        event: { type: 'approved', paymentId: 'p1', authCode: 'A', method: 'card' },
      },
    );
    expect(state).toMatchObject({ status: 'failed', reason: 'cancelled' });
  });

  it('marks the terminal offline when the payment cannot be opened', () => {
    expect(run({ type: 'REQUEST', request }, { type: 'START_FAILED' })).toMatchObject({
      status: 'failed',
      reason: 'offline',
    });
  });
});

describe('MockGateway', () => {
  it('approves after a simulated tap', async () => {
    vi.useFakeTimers();
    const events: PaymentEvent[] = [];
    const gw = new MockGateway({ authoriseMs: 100 });
    const id = await gw.start(request, (e) => events.push(e));
    gw.simulateTap(id, 'wallet');
    vi.advanceTimersByTime(100);
    expect(events.map((e) => e.type)).toEqual([
      'waiting_tap',
      'authorising',
      'approved',
      'dispense',
    ]);
    vi.useRealTimers();
  });

  it('times out like the firmware when nobody taps', async () => {
    vi.useFakeTimers();
    const events: PaymentEvent[] = [];
    const gw = new MockGateway({ tapTimeoutMs: 1000 });
    await gw.start(request, (e) => events.push(e));
    vi.advanceTimersByTime(1000);
    expect(events.at(-1)).toMatchObject({ type: 'failed', reason: 'timeout' });
    vi.useRealTimers();
  });
});
