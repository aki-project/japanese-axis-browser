import { describe, expect, it } from 'vitest';
import { clearedSessionCookie, readCookie, sessionCookie } from './cookies.js';

describe('readCookie', () => {
  it('finds a named cookie among several', () => {
    expect(readCookie('a=1; jl_session=abc; b=2', 'jl_session')).toBe('abc');
  });

  it('returns undefined for a missing header, a missing cookie, or a bad encoding', () => {
    expect(readCookie(undefined, 'jl_session')).toBeUndefined();
    expect(readCookie('a=1', 'jl_session')).toBeUndefined();
    expect(readCookie('jl_session=%E0%A4%A', 'jl_session')).toBeUndefined();
  });

  it('does not match a cookie whose name merely ends with the wanted name', () => {
    expect(readCookie('xjl_session=evil', 'jl_session')).toBeUndefined();
  });
});

describe('session cookie', () => {
  it('is HttpOnly and SameSite=Lax, and Secure only when asked', () => {
    const plain = sessionCookie('t', { secure: false });
    expect(plain).toContain('HttpOnly');
    expect(plain).toContain('SameSite=Lax');
    expect(plain).not.toContain('Secure');
    expect(sessionCookie('t', { secure: true })).toContain('Secure');
  });

  it('is cleared with Max-Age=0', () => {
    expect(clearedSessionCookie({ secure: false })).toContain('Max-Age=0');
  });
});
