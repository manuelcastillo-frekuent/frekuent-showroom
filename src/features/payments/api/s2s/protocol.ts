/**
 * Contract of the Frekuent Payments API (external clients, QIM-488) as the
 * showroom screen uses it. The API is the source of truth: if a reply does not
 * match this, report it instead of bending the contract. Described in
 * docs/s2s-protocol.md; ../showroom-bff simulates the same contract.
 *
 *   POST {auth}/clients/token                       client credentials → token
 *   POST {auth}/clients/token/refresh               refresh token → token
 *   POST {payments}/create                          open a charge
 *   POST {payments}/{uuid}/pay                      show it on the Spot (60 s)
 *   GET  {payments}/{uuid}/status                   polled: the only way to learn of it
 *   POST {payments}/{uuid}/dispense                 how the delivery went → 204
 *   POST {payments}/{uuid}/cancel                   leave the charge
 *   GET  {payments}/list                            find a lost charge at startup
 */

export const PAYMENT_STATUSES = [
  'pending',
  'in_progress',
  'authorized',
  'completed',
  'failed',
  'cancelled',
  'timeout',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Statuses after which the charge never changes again. */
export const FINAL_STATUSES: readonly PaymentStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'timeout',
  'refunded',
];

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  /** Seconds. */
  expires_in: number;
}

export interface CreateBody {
  /** Cents, ≥ 1. */
  amount: number;
  device_serial: number;
  /** Shown on the Spot, ≤ 255 characters. */
  product_description?: string;
}

export interface ChargeReply {
  transaction_uuid: string;
  status: PaymentStatus;
  status_code: number;
}

export interface StatusReply extends ChargeReply {
  device_serial: number;
  amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface ListReply {
  items: StatusReply[];
  total: number;
}

export type CancelReason =
  | 'USER_ABORT'
  | 'PRODUCT_NOT_DISPENSED'
  | 'DEVICE_ERROR'
  | 'TIMEOUT'
  | 'DUPLICATE_CHARGE'
  | 'MANUAL_ADJUSTMENT';

/** Error codes the screen acts on (`error_code` in the error body). */
export const ERR = {
  tokenInvalid: 100,
  tokenExpired: 101,
  conflict: 400,
  deviceNotConnected: 402,
  notCancellable: 409,
  invalidState: 409,
  notCompleted: 410,
  alreadyRefunded: 412,
  paymentExpired: 414,
  dispenseInProgress: 415,
} as const;

/** 403 codes that mean "this client cannot charge here": configuration, never retried. */
export const FORBIDDEN_CONFIG_CODES = [200, 201, 202, 204] as const;

/** A reply with an error status. What decides is `errorCode`, not the message. */
export class ApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly errorCode: number | null,
    readonly error: string,
    message: string,
  ) {
    super(`${httpStatus}·${errorCode ?? '?'} ${error}: ${message}`);
    this.name = 'ApiError';
  }

  is(httpStatus: number, errorCode?: number) {
    return (
      this.httpStatus === httpStatus && (errorCode === undefined || this.errorCode === errorCode)
    );
  }
}

/** Builds the ApiError for a failed reply from its `{ error_code, error, message }` body. */
export function toApiError(httpStatus: number, body: unknown): ApiError {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const code = typeof b.error_code === 'number' ? b.error_code : Number(b.error_code);
  return new ApiError(
    httpStatus,
    Number.isFinite(code) ? code : null,
    typeof b.error === 'string' ? b.error : 'error',
    typeof b.message === 'string' ? b.message : '',
  );
}

function record(data: unknown, what: string) {
  if (typeof data !== 'object' || data === null) throw new Error(`${what}: not an object`);
  return data as Record<string, unknown>;
}

function isStatus(value: unknown): value is PaymentStatus {
  return (PAYMENT_STATUSES as readonly unknown[]).includes(value);
}

export function parseToken(data: unknown): TokenResponse {
  const r = record(data, 'token');
  if (typeof r.access_token !== 'string' || typeof r.expires_in !== 'number')
    throw new Error('token: missing access_token or expires_in');
  return r as unknown as TokenResponse;
}

export function parseCharge(data: unknown): ChargeReply {
  const r = record(data, 'charge');
  if (typeof r.transaction_uuid !== 'string' || !isStatus(r.status))
    throw new Error('charge: bad transaction_uuid or status');
  return r as unknown as ChargeReply;
}

export function parseList(data: unknown): ListReply {
  const r = record(data, 'list');
  if (!Array.isArray(r.items)) throw new Error('list: missing items');
  return { items: r.items.map(parseCharge) as StatusReply[], total: Number(r.total ?? 0) };
}
