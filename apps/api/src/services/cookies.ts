/** The session cookie: an opaque token, HttpOnly so page scripts never see it. */
export const SESSION_COOKIE = 'jl_session';

/** Sessions last 30 days from login. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Reads one cookie's value from a Cookie request header, or undefined. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface CookieOptions {
  /** Adds `Secure`; set in production, where the site is served over HTTPS. */
  secure: boolean;
}

/** Set-Cookie value for a session token. SameSite=Lax keeps it off cross-site POSTs. */
export function sessionCookie(token: string, { secure }: CookieOptions): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** Set-Cookie value that removes the session cookie. */
export function clearedSessionCookie({ secure }: CookieOptions): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
