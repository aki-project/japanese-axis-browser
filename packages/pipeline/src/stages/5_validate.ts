/**
 * Stage 5: validate. Parses every line of every processed file against
 * the zod schemas (from packages/shared for entries and links, and
 * locally-defined ones - see lib/hubRecords.ts - for hubs and hub
 * members), failing on the first bad record and printing it. Then
 * checks referential integrity: every link endpoint and every hub
 * membership's entryId must exist as a kanji or word entry, every
 * membership's hubId must exist in hubs.jsonl, and each hub's
 * memberCount must equal its actual membership row count exactly.
 * Finally prints the isolated-entry count (the seed stage is the one
 * that must fail on a nonzero count; this stage just reports it, since
 * some isolated kanji/words are expected in the full dataset). An
 * entry counts as connected here if it has a pairwise link on any axis
 * OR belongs to a hub (hubs.jsonl only ever contains hubs with two or
 * more members, since buildHubs already dropped smaller ones).
 *
 * Usage: tsx src/stages/5_validate.ts [--dir=processed|seed]
 */
import {
  kanjiSchema,
  vocabularyItemSchema,
  radicalSchema,
  componentSchema,
  linkSchema,
  kanjiEntryId,
  wordEntryId,
} from '@japanesesite/shared';
import type { z } from 'zod';
import { PROCESSED, SEED } from '../lib/paths.js';
import { readJsonl } from '../lib/jsonl.js';
import { hubRecordSchema, hubMemberRecordSchema } from '../lib/hubRecords.js';

interface ValidateResult {
  count: number;
}

async function validateFile<S extends z.ZodTypeAny>(
  label: string,
  filePath: string,
  schema: S,
  onRecord?: (rec: z.infer<S>) => void,
): Promise<ValidateResult> {
  let count = 0;
  for await (const raw of readJsonl(filePath)) {
    const result = schema.safeParse(raw);
    if (!result.success) {
      console.error(`\nVALIDATION FAILED: ${label} record #${count + 1} in ${filePath}`);
      console.error('Record:', JSON.stringify(raw, null, 2));
      console.error('Errors:', result.error.message);
      process.exitCode = 1;
      throw new Error(`validation failed for ${label}`);
    }
    onRecord?.(result.data);
    count += 1;
  }
  console.log(`  ${label}: ${count} records OK`);
  return { count };
}

async function main(): Promise<void> {
  const dirArg = process.argv.find((a) => a.startsWith('--dir='));
  const which = dirArg ? dirArg.split('=')[1] : 'processed';
  const paths = which === 'seed' ? SEED : PROCESSED;
  console.log(`validating data/${which}/*.jsonl ...`);

  const entryIds = new Set<string>();

  await validateFile('kanji', paths.kanji, kanjiSchema, (k) => {
    entryIds.add(kanjiEntryId(k.literal));
  });
  await validateFile('words', paths.words, vocabularyItemSchema, (w) => {
    entryIds.add(wordEntryId(w.entSeq));
  });
  await validateFile('radicals', paths.radicals, radicalSchema);
  await validateFile('components', paths.components, componentSchema);

  let missingEndpoints = 0;
  const referenced = new Set<string>();
  let linkCount = 0;
  await validateFile('links', paths.links, linkSchema, (link) => {
    linkCount += 1;
    if (!entryIds.has(link.fromEntryId)) {
      missingEndpoints += 1;
      console.error(`  dangling fromEntryId: ${link.fromEntryId}`);
    } else {
      referenced.add(link.fromEntryId);
    }
    if (!entryIds.has(link.toEntryId)) {
      missingEndpoints += 1;
      console.error(`  dangling toEntryId: ${link.toEntryId}`);
    } else {
      referenced.add(link.toEntryId);
    }
  });

  if (missingEndpoints > 0) {
    console.error(`\n${missingEndpoints} link endpoint(s) do not exist as kanji or word entries.`);
    process.exitCode = 1;
    throw new Error('dangling link endpoints');
  }
  console.log(`\nlinks: ${linkCount} total, all endpoints resolve.`);

  const hubIds = new Set<string>();
  const declaredMemberCount = new Map<string, number>();
  await validateFile('hubs', paths.hubs, hubRecordSchema, (h) => {
    hubIds.add(h.hubId);
    declaredMemberCount.set(h.hubId, h.memberCount);
  });

  const actualMemberCount = new Map<string, number>();
  let hubMemberCount = 0;
  await validateFile('hubMembers', paths.hubMembers, hubMemberRecordSchema, (m) => {
    hubMemberCount += 1;
    if (!hubIds.has(m.hubId)) {
      console.error(`\nVALIDATION FAILED: hub_members references unknown hubId ${m.hubId}`);
      process.exitCode = 1;
      throw new Error('dangling hub_members.hubId');
    }
    if (!entryIds.has(m.entryId)) {
      console.error(`\nVALIDATION FAILED: hub_members references unknown entryId ${m.entryId}`);
      process.exitCode = 1;
      throw new Error('dangling hub_members.entryId');
    }
    referenced.add(m.entryId);
    actualMemberCount.set(m.hubId, (actualMemberCount.get(m.hubId) ?? 0) + 1);
  });

  for (const [id, declared] of declaredMemberCount) {
    const actual = actualMemberCount.get(id) ?? 0;
    if (actual !== declared) {
      console.error(
        `\nVALIDATION FAILED: hub ${id} declares memberCount=${declared} but has ${actual} membership row(s)`,
      );
      process.exitCode = 1;
      throw new Error('hub memberCount mismatch');
    }
  }
  console.log(`\nhubs: ${hubIds.size} total, ${hubMemberCount} membership rows, all memberCounts match.`);

  const isolated = [...entryIds].filter((id) => !referenced.has(id));
  console.log(`isolated entries (no link on any axis and no hub membership): ${isolated.length} / ${entryIds.size}`);

  console.log('\nvalidate stage complete.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
