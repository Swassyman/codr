import { serverClock } from './server-time';

export interface FieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** Field-level validation messages keyed by field path. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as FieldIssue[]) {
        if (d && typeof d.path === 'string' && !(d.path in out)) out[d.path] = d.message;
      }
    }
    return out;
  }
}

function readCookie(name: string) {
  const entry = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function send(method: string, url: string, body: unknown, options: RequestOptions) {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('codr_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  const sentAt = Date.now();
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal: options.signal,
  });
  const serverTime = res.headers.get('x-server-time');
  if (serverTime) serverClock.observeResponse(Number(serverTime), sentAt, Date.now());
  return res;
}

async function request<T>(method: string, url: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await send(method, url, body, options);
    if (res.status === 403 && method !== 'GET') {
      // A missing/rotated CSRF cookie: fetch a fresh one and retry once.
      const peek = await res.clone().json().catch(() => null);
      if (peek?.error?.code === 'csrf_failed') {
        await send('GET', '/api/auth/me', undefined, {});
        res = await send(method, url, body, options);
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection; your work is kept locally.');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `Request failed (${res.status}).`, e?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string, options?: RequestOptions) => request<T>('GET', url, undefined, options),
  post: <T>(url: string, body?: unknown, options?: RequestOptions) => request<T>('POST', url, body ?? {}, options),
  put: <T>(url: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', url, body ?? {}, options),
  patch: <T>(url: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', url, body ?? {}, options),
  del: <T>(url: string, options?: RequestOptions) => request<T>('DELETE', url, undefined, options),
};

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
