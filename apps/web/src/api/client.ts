import {
  apiErrorSchema,
  entryResponseSchema,
  linksResponseSchema,
  searchResponseSchema,
  type Axis,
  type EntryResponse,
  type LinksResponse,
  type SearchResponse,
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
  let res: Response;
  try {
    res = await fetch(url);
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
}

export async function getLinks(
  entryId: string,
  { axis, limit, cursor }: GetLinksParams,
): Promise<LinksResponse> {
  const params = new URLSearchParams();
  params.set('axis', axis.join(','));
  if (limit !== undefined) params.set('limit', String(limit));
  if (cursor !== undefined) params.set('cursor', cursor);
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
