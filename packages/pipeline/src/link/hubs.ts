/**
 * Shared plumbing for building the family-relation outputs
 * (data/processed/hubs.jsonl and hub_members.jsonl). See CLAUDE.md,
 * "Two storage shapes": a family ("everything that shares an X") is a
 * Hub plus its memberships, never pairwise link rows.
 *
 * Each hub kind's axis module (phonetic.ts, semantic.ts, structural.ts)
 * builds its own `HubGroupInput`s - one per hub key - and hands them to
 * `buildHubs`, which dedupes members by entry ID and drops any hub left
 * with fewer than two members. There is no per-entry cap here: capping
 * a family is exactly what the old pairwise-link model got wrong (see
 * CLAUDE.md), so a member's hub memberships are never truncated. The
 * one exception, gloss hub *size*, is handled by `capHubSize` in
 * semantic.ts, not here.
 */
import type { EntryId, HubKind } from '@japanesesite/shared';
import { hubId } from '@japanesesite/shared';
import type { HubMemberRecord, HubRecord } from '../lib/hubRecords.js';

export interface HubMemberInput {
  entryId: EntryId;
  rank: number | null;
}

/** One hub-to-be: `key` is the raw hub key (before `hubId()` prefixing), `label` is what a human sees. */
export interface HubGroupInput {
  key: string;
  label: string;
  members: HubMemberInput[];
}

export interface HubBuildResult {
  hubs: HubRecord[];
  members: HubMemberRecord[];
}

/**
 * Builds hub + membership rows for one hub kind from a set of groups
 * (one hub per distinct key). Members are deduped by entry ID within a
 * group (first rank seen wins - the same entry should never disagree
 * with itself on rank within one group). A hub left with fewer than
 * two distinct members is dropped entirely and contributes no rows.
 */
export function buildHubs(kind: HubKind, groups: Iterable<HubGroupInput>): HubBuildResult {
  const hubs: HubRecord[] = [];
  const members: HubMemberRecord[] = [];
  for (const group of groups) {
    const byEntry = new Map<EntryId, number | null>();
    for (const m of group.members) {
      if (!byEntry.has(m.entryId)) byEntry.set(m.entryId, m.rank);
    }
    if (byEntry.size < 2) continue;
    const id = hubId(kind, group.key);
    hubs.push({ hubId: id, kind, label: group.label, memberCount: byEntry.size });
    for (const [entryId, rank] of byEntry) {
      members.push({ hubId: id, entryId, rank });
    }
  }
  return { hubs, members };
}

/** Concatenates several hub-build results (one per hub kind) into one. */
export function mergeHubResults(...results: HubBuildResult[]): HubBuildResult {
  const hubs: HubRecord[] = [];
  const members: HubMemberRecord[] = [];
  for (const r of results) {
    for (const h of r.hubs) hubs.push(h);
    for (const m of r.members) members.push(m);
  }
  return { hubs, members };
}

/**
 * Drops any hub with more than `maxSize` members, along with its
 * membership rows. Only meant for gloss hubs (CLAUDE.md: "a gloss like
 * 'to do' is not a useful family") - every other hub kind has no size
 * cap. Returns the number of hubs dropped for reporting.
 */
export function capHubSize(
  result: HubBuildResult,
  maxSize: number,
): { result: HubBuildResult; dropped: number } {
  const keepIds = new Set(result.hubs.filter((h) => h.memberCount <= maxSize).map((h) => h.hubId));
  const dropped = result.hubs.length - keepIds.size;
  return {
    result: {
      hubs: result.hubs.filter((h) => keepIds.has(h.hubId)),
      members: result.members.filter((m) => keepIds.has(m.hubId)),
    },
    dropped,
  };
}
