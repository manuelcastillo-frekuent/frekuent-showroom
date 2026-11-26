import { callNative } from './nativeBridge';

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  /** JSON text, if any. */
  body?: string;
}

export interface HttpResponse {
  status: number;
  /** Parsed JSON, or null for an empty body (204). */
  body: unknown;
}

/**
 * How a request reaches the API. The Payments API has no CORS yet, so the
 * screen must be able to call it either from the WebView (`fetch`, fine while
 * a tunnel adds CORS) or through the APK's native side, where CORS does not exist.
 * A network failure rejects; an HTTP error status resolves.
 */
export interface HttpTransport {
  send(request: HttpRequest): Promise<HttpResponse>;
}

const parse = (text: string): unknown => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const fetchTransport = (
  fetchFn: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): HttpTransport => ({
  async send({ method, url, headers, body }) {
    const response = await fetchFn(url, { method, headers, body });
    return { status: response.status, body: parse(await response.text()) };
  },
});

/** The same request, made by the APK (MainActivity `request`). */
export const nativeTransport = (): HttpTransport => ({
  async send(request) {
    const reply = await callNative<{ status: number; body: string }>('request', request);
    return { status: reply.status, body: parse(reply.body) };
  },
});
