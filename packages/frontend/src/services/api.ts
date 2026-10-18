import {
  apiErrorSchema,
  authResponseSchema,
  characterListResponseSchema,
  healthResponseSchema,
  meResponseSchema,
  noContentSchema,
  registerBodySchema,
  scriptDetailSchema,
  scriptListResponseSchema,
  ttsVoicesResponseSchema,
  uploadScriptResponseSchema,
  type AuthResponse,
  type CharacterListResponse,
  type HealthResponse,
  type LoginBody,
  type MeResponse,
  type RegisterBody,
  type ScriptDetail,
  type ScriptListResponse,
  type SynthesizeSpeechBody,
  type TtsVoicesResponse,
  type UploadScriptResponse,
  type ZodType,
} from '@osvald/shared';

/**
 * Typed API client.
 *
 * Every call declares the shared Zod schema it expects, so responses are
 * validated at runtime with the exact same contract the backend validated
 * against — a drifted response fails loudly instead of poisoning the UI.
 */

const DEFAULT_BASE_URL = 'http://localhost:3000';

/** Backend base URL, without a trailing slash. */
export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(
  /\/+$/,
  '',
);

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON request body. */
  body?: unknown;
  /** Multipart body — takes precedence over `body`. */
  formData?: FormData;
  /** Bearer token; falls back to the registered provider when omitted. */
  token?: string | null;
  /** Set for the auth endpoints themselves, which must not send a token. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

/*
 * The token is supplied by a callback rather than imported from the auth store,
 * so this module stays free of store imports — the store imports the client,
 * and the reverse would be a cycle.
 */
type TokenProvider = () => string | null;

let tokenProvider: TokenProvider = () => null;
let onUnauthorized: (() => void) | null = null;

export function setAuthTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

/** Called when the API rejects a token, so the app can sign the user out. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export async function request<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: BodyInit | undefined;

  if (options.formData !== undefined) {
    // Never set content-type manually: the browser adds the multipart boundary.
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const token = options.anonymous === true ? null : (options.token ?? tokenProvider());

  if (token !== null && token.length > 0) {
    headers.authorization = `Bearer ${token}`;
  }

  // TODO(api): retry/backoff for idempotent GETs, plus a request timeout.
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    signal: options.signal,
  });

  // 204 carries no body, so parsing it would throw.
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && options.anonymous !== true) {
      // The stored token is gone or expired; let the app react once, centrally.
      onUnauthorized?.();
    }

    const parsedError = apiErrorSchema.safeParse(payload);
    throw new ApiError(
      parsedError.success ? parsedError.data.message : `Request failed (HTTP ${response.status})`,
      response.status,
      parsedError.success ? parsedError.data.details : payload,
    );
  }

  return schema.parse(payload);
}

/**
 * Same contract as `request`, for endpoints that answer with bytes.
 *
 * Synthesised speech is the only one today. It cannot go through `request`,
 * which parses every response as JSON — but the auth header, the 401 handling
 * and the error shape all have to behave identically, so the differences are
 * kept to the response handling alone.
 */
export async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const token = options.anonymous === true ? null : (options.token ?? tokenProvider());

  if (token !== null && token.length > 0) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    signal: options.signal,
  });

  if (!response.ok) {
    if (response.status === 401 && options.anonymous !== true) {
      onUnauthorized?.();
    }

    // The failure body is JSON even though the success body is not.
    const payload: unknown = await response.json().catch(() => null);
    const parsedError = apiErrorSchema.safeParse(payload);

    throw new ApiError(
      parsedError.success ? parsedError.data.message : `Request failed (HTTP ${response.status})`,
      response.status,
      parsedError.success ? parsedError.data.details : payload,
    );
  }

  return response.blob();
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }

  const serialised = search.toString();
  return serialised.length > 0 ? `?${serialised}` : '';
}

export interface UploadScriptInput {
  file: File;
  title?: string;
  author?: string;
}

export const api = {
  /** `GET /health` — called on app load; needs no token. */
  getHealth(signal?: AbortSignal): Promise<HealthResponse> {
    return request('/health', healthResponseSchema, { signal, anonymous: true });
  },

  listScripts(
    params: { limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ): Promise<ScriptListResponse> {
    return request(`/scripts${query(params)}`, scriptListResponseSchema, { signal });
  },

  getScript(id: string, signal?: AbortSignal): Promise<ScriptDetail> {
    return request(`/scripts/${encodeURIComponent(id)}`, scriptDetailSchema, { signal });
  },

  getScriptCharacters(id: string, signal?: AbortSignal): Promise<CharacterListResponse> {
    return request(`/scripts/${encodeURIComponent(id)}/characters`, characterListResponseSchema, {
      signal,
    });
  },

  uploadScript(input: UploadScriptInput): Promise<UploadScriptResponse> {
    const formData = new FormData();
    formData.append('file', input.file);

    if (input.title !== undefined) {
      formData.append('title', input.title);
    }
    if (input.author !== undefined) {
      formData.append('author', input.author);
    }

    return request('/scripts/upload', uploadScriptResponseSchema, {
      method: 'POST',
      formData,
    });
  },

  /** Re-runs the parsing pipeline over the stored PDF. */
  reparseScript(id: string): Promise<UploadScriptResponse> {
    return request(`/scripts/${encodeURIComponent(id)}/reparse`, uploadScriptResponseSchema, {
      method: 'POST',
    });
  },

  deleteScript(id: string): Promise<null> {
    return request(`/scripts/${encodeURIComponent(id)}`, noContentSchema, { method: 'DELETE' });
  },

  login(body: LoginBody): Promise<AuthResponse> {
    return request('/auth/login', authResponseSchema, {
      method: 'POST',
      body,
      anonymous: true,
    });
  },

  register(body: RegisterBody): Promise<AuthResponse> {
    // Fail fast on obviously invalid input before hitting the API.
    return request('/auth/register', authResponseSchema, {
      method: 'POST',
      body: registerBodySchema.parse(body),
      anonymous: true,
    });
  },

  me(token?: string): Promise<MeResponse> {
    return request('/auth/me', meResponseSchema, { token });
  },

  /** `GET /tts/voices` — the voices the server can synthesise. */
  listTtsVoices(signal?: AbortSignal): Promise<TtsVoicesResponse> {
    return request('/tts/voices', ttsVoicesResponseSchema, { signal });
  },

  /** `POST /tts/speak` — one line of dialogue, rendered to audio. */
  speak(body: SynthesizeSpeechBody, signal?: AbortSignal): Promise<Blob> {
    return requestBlob('/tts/speak', { method: 'POST', body, signal });
  },
};

/** Turns anything thrown by the client into a string safe to render. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `[${error.status}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unexpected error';
}
