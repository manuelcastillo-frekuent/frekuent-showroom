/**
 * WebSocket messages between the showroom screen and the server.
 * PROVISIONAL: to be agreed with backend (Ángel). The human-readable version
 * lives in docs/ws-protocol.md; keep both in sync.
 */

/** Screen → server */
export type ClientMessage =
  | {
      type: 'sale_request';
      requestId: string;
      spot: 'pro' | 'compact' | 'mini';
      productCode: string;
      amountCents: number;
    }
  | { type: 'cancel_request'; paymentId: string }
  | { type: 'dispense_result'; paymentId: string; success: boolean };

/** Server → screen */
export type ServerMessage =
  | { type: 'sale_accepted'; requestId: string; paymentId: string }
  /** The payment could not be opened, so there is no paymentId (payments-api 409). */
  | { type: 'sale_rejected'; requestId: string; reason: 'offline' }
  | { type: 'payment_status'; paymentId: string; status: 'waiting_tap' | 'authorising' }
  | {
      type: 'payment_approved';
      paymentId: string;
      authCode: string;
      method: 'card' | 'wallet';
    }
  | {
      type: 'payment_failed';
      paymentId: string;
      reason: 'declined' | 'rejected' | 'timeout' | 'cancelled';
    }
  | { type: 'dispense'; paymentId: string; productCode: string };

type Field = 'string' | readonly string[];

/** Required fields per message type: `'string'` or the allowed values. */
const SHAPES: Record<ServerMessage['type'], Record<string, Field>> = {
  sale_accepted: { requestId: 'string', paymentId: 'string' },
  sale_rejected: { requestId: 'string', reason: ['offline'] },
  payment_status: { paymentId: 'string', status: ['waiting_tap', 'authorising'] },
  payment_approved: { paymentId: 'string', authCode: 'string', method: ['card', 'wallet'] },
  payment_failed: {
    paymentId: 'string',
    reason: ['declined', 'rejected', 'timeout', 'cancelled'],
  },
  dispense: { paymentId: 'string', productCode: 'string' },
};

/** Parses one frame from the server; throws if it does not match the contract. */
export function parseServerMessage(raw: unknown): ServerMessage {
  const data: unknown = JSON.parse(String(raw));
  if (typeof data !== 'object' || data === null) throw new Error('Not an object');
  const message = data as Record<string, unknown>;
  const type = message.type as ServerMessage['type'];
  const shape = Object.hasOwn(SHAPES, type) ? SHAPES[type] : undefined;
  if (!shape) throw new Error(`Unknown type: ${String(message.type)}`);
  for (const [key, field] of Object.entries(shape)) {
    const value = message[key];
    const ok = field === 'string' ? typeof value === 'string' : field.includes(value as string);
    if (!ok) throw new Error(`Bad field ${key} in ${String(message.type)}`);
  }
  return message as ServerMessage;
}
