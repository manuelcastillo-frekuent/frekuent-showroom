import type { FailReason, PaymentState } from '@/features/payments';
import { formatCents } from '@/shared/utils/format';
import { CODE_LENGTH } from '../domain/keypad';

const FAIL_SHORT: Record<FailReason, string> = {
  declined: 'Declined',
  rejected: 'Rejected',
  timeout: 'Timed out',
  cancelled: 'Cancelled',
  offline: 'Offline',
  refunded: 'Not completed',
};

/**
 * The two text lines under the code on the machine's small screen. A failed
 * delivery shows two messages in turn; `refundShown` picks the second one.
 */
export function displayLines(
  state: PaymentState,
  code: string,
  error: string | null,
  refundShown = false,
): [string, string] {
  switch (state.status) {
    case 'requesting':
    case 'waiting_tap':
      return [formatCents(state.request.amountCents), 'Pay →'];
    case 'authorising':
      return [formatCents(state.request.amountCents), 'Authorising…'];
    case 'dispensing':
      return ['Approved', 'Dispensing…'];
    case 'delivered':
      return ['Thanks', 'Take below'];
    case 'undelivered':
      return refundShown ? ['Refund issued', ''] : ['Not delivered', ''];
    case 'failed':
      return [FAIL_SHORT[state.reason], 'Try again'];
    case 'idle':
      if (error) return [error, 'Try another'];
      return code ? ['2nd digit', ''] : ['Enter', 'the code'];
  }
}

/** Typed code with a cursor while incomplete, or a placeholder when empty. */
export const shownCode = (code: string) =>
  code ? code + (code.length < CODE_LENGTH ? '_' : '') : '— —';
