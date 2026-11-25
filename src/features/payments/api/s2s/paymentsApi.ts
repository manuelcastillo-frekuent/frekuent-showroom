import {
  parseSaleResponse,
  parseStatusResponse,
  type SaleRequestBody,
  type StatusResponse,
} from './protocol';

/** HTTP calls to the payments service; tests pass a fake. */
export interface PaymentsApi {
  createSale(body: SaleRequestBody): Promise<string>;
  getStatus(paymentId: string): Promise<StatusResponse>;
  cancel(paymentId: string): Promise<void>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Talks straight to the payments service, with no BFF in between. */
export function createPaymentsApi(
  baseUrl: string,
  fetchFn: FetchLike = (url, init) => fetch(url, init),
): PaymentsApi {
  const base = baseUrl.replace(/\/$/, '');

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetchFn(`${base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${response.status}`);
    return response.status === 204 || response.status === 202 ? null : response.json();
  }

  return {
    async createSale(body) {
      const data = await call('/sales', { method: 'POST', body: JSON.stringify(body) });
      return parseSaleResponse(data).paymentId;
    },
    async getStatus(paymentId) {
      return parseStatusResponse(await call(`/payments/${encodeURIComponent(paymentId)}`));
    },
    async cancel(paymentId) {
      await call(`/payments/${encodeURIComponent(paymentId)}/cancel`, { method: 'POST' });
    },
  };
}
