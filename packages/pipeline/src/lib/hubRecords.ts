/**
 * Local zod schemas for the two hub-model outputs
 * (data/processed/hubs.jsonl and data/processed/hub_members.jsonl).
 * These mirror the shapes described in CLAUDE.md (Hub / HubMember) but
 * are not part of the packages/shared API contract - hubs are a
 * pipeline+DB concept only, the API materializes siblings from them at
 * request time rather than exposing a Hub type of its own yet.
 */
import { z } from 'zod';
import { HUB_KINDS, entryIdSchema, parseHubId } from '@japanesesite/shared';

export const hubKindSchema = z.enum(HUB_KINDS);

export const hubRecordSchema = z.object({
  hubId: z.string().refine((id) => parseHubId(id) !== null, {
    message: 'hubId must be h:<kind>:<key>',
  }),
  kind: hubKindSchema,
  label: z.string().min(1),
  memberCount: z.number().int().min(2),
});
export type HubRecord = z.infer<typeof hubRecordSchema>;

export const hubMemberRecordSchema = z.object({
  hubId: z.string(),
  entryId: entryIdSchema,
  rank: z.number().int().nullable(),
});
export type HubMemberRecord = z.infer<typeof hubMemberRecordSchema>;
