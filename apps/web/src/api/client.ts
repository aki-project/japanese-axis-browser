import {
  apiErrorSchema,
  collectionsResponseSchema,
  entryResponseSchema,
  linksResponseSchema,
  searchResponseSchema,
  sessionResponseSchema,
  type Axis,
  type CollectionsResponse,
  type EntryResponse,
  type JlptFilterKey,
  type LinksResponse,
  type LoginRequest,
  type RegisterRequest,
  type SaveCollectionsRequest,
  type SearchResponse,
  type SessionResponse,
} from '@japanesesite/shared';

/**
 * Thrown whenever the API returns a non-ok response. Carries the error
 * code and message from the `{ error: { code, message } }` body when the
 * body parses; falls back to a generic code/message otherwise.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

async function parseErrorResponse(res: Response): Promise<never> {
  let code = 'unknown_error';
  let message = `Request failed with status ${res.status}`;
  try {
    const body: unknown = await res.json();
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      code = parsed.data.error.code;
      message = parsed.data.error.message;
    }
  } catch {
    // body was not JSON or was empty; fall back to the generic message.
  }
  throw new ApiClientError(res.status, code, message);
}

async function getJson(url: string): Promise<unknown> {
  return requestJson(url);
}

/** Same-origin request, so the session cookie is sent; JSON in and out. */
async function requestJson(
  url: string,
  init?: { method: 'POST' | 'PUT'; body: unknown },
): Promise<unknown> {
  let res: Response;
  try {
    res = init
      ? await fetch(url, {
          method: init.method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(init.body),
        })
      : await fetch(url);
  } catch {
    throw new ApiClientError(0, 'network_error', 'Could not reach the server.');
  }
  if (!res.ok) {
    return parseErrorResponse(res);
  }
  return res.json() as Promise<unknown>;
}

export async function getEntry(entryId: string): Promise<EntryResponse> {
  const body = await getJson(`/api/entries/${encodeURIComponent(entryId)}`);
  return entryResponseSchema.parse(body);
}

export interface GetLinksParams {
  axis: readonly Axis[];
  limit?: number;
  cursor?: string;
  /** Only list links to entries at these JLPT levels ('none' = no level). Omit for no filter. */
  jlpt?: readonly JlptFilterKey[];
}

export async function getLinks(
  entryId: string,
  { axis, limit, cursor, jlpt }: GetLinksParams,
): Promise<LinksResponse> {
  const params = new URLSearchParams();
  params.set('axis', axis.join(','));
  if (limit !== undefined) params.set('limit', String(limit));
  if (cursor !== undefined) params.set('cursor', cursor);
  if (jlpt !== undefined) params.set('jlpt', jlpt.join(','));
  const body = await getJson(
    `/api/entries/${encodeURIComponent(entryId)}/links?${params.toString()}`,
  );
  return linksResponseSchema.parse(body);
}

export async function searchEntries(query: string, limit?: number): Promise<SearchResponse> {
  const params = new URLSearchParams();
  params.set('q', query);
  if (limit !== undefined) params.set('limit', String(limit));
  const body = await getJson(`/api/entries/search?${params.toString()}`);
  return searchResponseSchema.parse(body);
}

// ---- Account and collections ----

export async function getSession(): Promise<SessionResponse> {
  return sessionResponseSchema.parse(await getJson('/api/auth/session'));
}

export async function register(request: RegisterRequest): Promise<SessionResponse> {
  const body = await requestJson('/api/auth/register', { method: 'POST', body: request });
  return sessionResponseSchema.parse(body);
}

export async function login(request: LoginRequest): Promise<SessionResponse> {
  const body = await requestJson('/api/auth/login', { method: 'POST', body: request });
  return sessionResponseSchema.parse(body);
}

export async function logout(): Promise<SessionResponse> {
  const body = await requestJson('/api/auth/logout', { method: 'POST', body: {} });
  return sessionResponseSchema.parse(body);
}

export async function getCollections(): Promise<CollectionsResponse> {
  return collectionsResponseSchema.parse(await getJson('/api/collections'));
}

/** Rejects with a 409 ApiClientError if the stored version or the session's user has changed. */
export async function saveCollections(request: SaveCollectionsRequest): Promise<CollectionsResponse> {
  const body = await requestJson('/api/collections', { method: 'PUT', body: request });
  return collectionsResponseSchema.parse(body);
}
