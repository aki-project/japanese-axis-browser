/**
 * Stage 5: validate. Parses every line of every processed file against
 * the zod schemas from packages/shared, failing on the first bad
 * record and printing it. Then checks referential integrity between
 * links and entries, and prints the isolated-entry count (the seed
 * stage is the one that must fail on a nonzero count; this stage just
 * reports it, since some isolated kanji/words are expected in the full
 * dataset).
 *
 * Usage: tsx src/stages/validate.ts [--dir=processed|seed]
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

  const isolated = [...entryIds].filter((id) => !referenced.has(id));
  console.log(`\nlinks: ${linkCount} total, all endpoints resolve.`);
  console.log(`isolated entries (no link on any axis): ${isolated.length} / ${entryIds.size}`);

  console.log('\nvalidate stage complete.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
