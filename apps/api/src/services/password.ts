import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with Node's built-in scrypt. A stored hash is
 * `scrypt$N$r$p$<salt>$<key>` (base64url), so the cost parameters can
 * be raised later without breaking existing hashes.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function scryptAsync(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, keyText] = parts;
  const expected = Buffer.from(keyText ?? '', 'base64url');
  if (expected.length !== KEY_LENGTH) return false;
  const key = await scryptAsync(password, Buffer.from(saltText ?? '', 'base64url'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, expected);
}

let dummyHash: Promise<string> | undefined;

/**
 * A hash of a random password, verified against when a login names an
 * unknown user so that the response takes as long as for a known one.
 */
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

/** A new opaque session token for the cookie. Only its hash is stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
