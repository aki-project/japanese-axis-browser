import { z } from 'zod';
import { parseEntryId } from './entryId.js';

/**
 * Accounts and the per-user "known" collections. The content API stays
 * anonymous and cacheable; these schemas cover only the /api/auth and
 * /api/collections routes.
 */

/** Upper bound on each collection, so one PUT cannot store an unbounded blob. */
export const MAX_COLLECTION_SIZE = 50_000;

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_.-]+$/, {
    message: 'Username may contain only letters, digits, and _ . -',
  });

export const passwordSchema = z.string().min(8).max(200);

export const registerRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  /** Today's date written with the Japanese era, e.g. 令和8年11月19日. Checked by the server. */
  eraDate: z.string().trim().min(1).max(40),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionUserSchema = z.object({
  username: z.string(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionResponseSchema = z.object({
  user: sessionUserSchema.nullable(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

const kanjiEntryIdSchema = z
  .string()
  .refine((id) => parseEntryId(id)?.kind === 'kanji', { message: 'Expected k:<kanji>' });
const wordEntryIdSchema = z
  .string()
  .refine((id) => parseEntryId(id)?.kind === 'word', { message: 'Expected w:<ent_seq>' });

/** The known-kanji and known-vocab collections, saved and loaded as one blob per user. */
export const knownCollectionsSchema = z.object({
  kanji: z.array(kanjiEntryIdSchema).max(MAX_COLLECTION_SIZE),
  vocab: z.array(wordEntryIdSchema).max(MAX_COLLECTION_SIZE),
});
export type KnownCollections = z.infer<typeof knownCollectionsSchema>;

export const collectionsResponseSchema = z.object({
  collections: knownCollectionsSchema,
  /** ISO timestamp of the last save, or null if the user has never saved. */
  updatedAt: z.string().nullable(),
  /** Incremented on every save; 0 if the user has never saved. */
  version: z.number().int().nonnegative(),
});
export type CollectionsResponse = z.infer<typeof collectionsResponseSchema>;

/**
 * PUT /api/collections body. The save is applied only if `username` is
 * still the session's user and `version` is still the stored version;
 * otherwise the server answers 409, so a stale tab cannot overwrite
 * newer collections or another user's.
 */
export const saveCollectionsRequestSchema = z.object({
  username: z.string(),
  version: z.number().int().nonnegative(),
  collections: knownCollectionsSchema,
});
export type SaveCollectionsRequest = z.infer<typeof saveCollectionsRequestSchema>;
