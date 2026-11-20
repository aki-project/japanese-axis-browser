/**
 * Stage 7: seed. Builds a small, connected subset of the full processed
 * data into data/seed/, then loads it (see 6_load.ts --dir=seed).
 *
 * Construction:
 *  1. Start from the kanji in "日本人学生語" and every word containing
 *     at least one of them.
 *  2. Expand one hop out from that base set on every axis: pairwise
 *     link partners (both directions) AND hub siblings (every other
 *     member of every hub the entry belongs to).
 *  3. Make sure at least one word exists for every JLPT level, pulling
 *     in a representative (plus one of its own neighbours, so it is
 *     never isolated) for any level missing from the base+neighbours.
 *  4. Cap at ~150 kanji / ~400 words, always keeping the seed kanji and
 *     the JLPT representatives, filling the rest deterministically.
 *  5. Keep only links whose both ends survived the cap, and only hub
 *     memberships whose entry survived - recomputing each surviving
 *     hub's memberCount from the subset's own membership rows (not the
 *     full dataset's), and dropping any hub left with fewer than two
 *     members in the subset.
 *  6. Iteratively drop any entry left with no pairwise link and no
 *     hub of size >= 2 until none remain (fails loudly if the base
 *     kanji themselves cannot avoid this) - dropping an entry can
 *     shrink another hub below two members, so this repeats until
 *     stable.
 */
import type { Kanji, VocabularyItem, Radical, Component, Link, JlptLevel } from '@japanesesite/shared';
import { kanjiEntryId, wordEntryId, JLPT_LEVELS } from '@japanesesite/shared';
import { PROCESSED, SEED } from '../lib/paths.js';
import { readJsonlAll, JsonlWriter } from '../lib/jsonl.js';
import type { HubRecord, HubMemberRecord } from '../lib/hubRecords.js';

const SEED_KANJI_LITERALS = [...'日本人学生語'];
const KANJI_CAP = 150;
const WORD_CAP = 400;

async function main(): Promise<void> {
  console.log('loading processed data...');
  const [kanjiAll, wordsAll, radicalsAll, componentsAll, linksAll, hubsAll, hubMembersAll] = await Promise.all([
    readJsonlAll<Kanji>(PROCESSED.kanji),
    readJsonlAll<VocabularyItem>(PROCESSED.words),
    readJsonlAll<Radical>(PROCESSED.radicals),
    readJsonlAll<Component>(PROCESSED.components),
    readJsonlAll<Link>(PROCESSED.links),
    readJsonlAll<HubRecord>(PROCESSED.hubs),
    readJsonlAll<HubMemberRecord>(PROCESSED.hubMembers),
  ]);

  const kanjiByLiteral = new Map(kanjiAll.map((k) => [k.literal, k]));
  const wordByEntSeq = new Map(wordsAll.map((w) => [w.entSeq, w]));
  const hubByHubId = new Map(hubsAll.map((h) => [h.hubId, h]));

  const linksByFrom = new Map<string, Link[]>();
  const linksByTo = new Map<string, Link[]>();
  for (const l of linksAll) {
    (linksByFrom.get(l.fromEntryId) ?? linksByFrom.set(l.fromEntryId, []).get(l.fromEntryId)!).push(l);
    (linksByTo.get(l.toEntryId) ?? linksByTo.set(l.toEntryId, []).get(l.toEntryId)!).push(l);
  }

  const membersByHub = new Map<string, HubMemberRecord[]>();
  const hubsByEntry = new Map<string, string[]>();
  for (const m of hubMembersAll) {
    (membersByHub.get(m.hubId) ?? membersByHub.set(m.hubId, []).get(m.hubId)!).push(m);
    (hubsByEntry.get(m.entryId) ?? hubsByEntry.set(m.entryId, []).get(m.entryId)!).push(m.hubId);
  }

  /** Pairwise link partners (both directions) plus every other member of every hub this entry belongs to. */
  function neighbours(entryId: string): string[] {
    const out: string[] = [];
    for (const l of linksByFrom.get(entryId) ?? []) out.push(l.toEntryId);
    for (const l of linksByTo.get(entryId) ?? []) out.push(l.fromEntryId);
    for (const hubId of hubsByEntry.get(entryId) ?? []) {
      for (const m of membersByHub.get(hubId) ?? []) {
        if (m.entryId !== entryId) out.push(m.entryId);
      }
    }
    return out;
  }

  // --- base set: the seed kanji, and every word containing one of them ---
  const baseKanji = new Set(SEED_KANJI_LITERALS.filter((c) => kanjiByLiteral.has(c)));
  if (baseKanji.size !== SEED_KANJI_LITERALS.length) {
    console.warn(
      `warning: some seed kanji are missing from KANJIDIC2: ${SEED_KANJI_LITERALS.filter((c) => !kanjiByLiteral.has(c)).join(', ')}`,
    );
  }
  const baseWords = new Set(
    wordsAll.filter((w) => [...w.surface].some((ch) => baseKanji.has(ch))).map((w) => w.entSeq),
  );
  console.log(`base: ${baseKanji.size} kanji, ${baseWords.size} words`);

  // --- one-hop neighbours on every axis ---
  const neighbourKanji = new Set<string>();
  const neighbourWords = new Set<number>();
  const addNeighboursOf = (entryId: string): void => {
    for (const n of neighbours(entryId)) {
      if (n.startsWith('k:')) {
        const literal = n.slice(2);
        if (!baseKanji.has(literal)) neighbourKanji.add(literal);
      } else if (n.startsWith('w:')) {
        const entSeq = Number.parseInt(n.slice(2), 10);
        if (!baseWords.has(entSeq)) neighbourWords.add(entSeq);
      }
    }
  };
  for (const literal of baseKanji) addNeighboursOf(kanjiEntryId(literal));
  for (const entSeq of baseWords) addNeighboursOf(wordEntryId(entSeq));
  console.log(`one-hop neighbours: ${neighbourKanji.size} kanji, ${neighbourWords.size} words`);

  // --- make sure every JLPT level is represented among the words ---
  const presentLevels = new Set<JlptLevel>();
  for (const entSeq of [...baseWords, ...neighbourWords]) {
    const level = wordByEntSeq.get(entSeq)?.jlptLevel;
    if (level) presentLevels.add(level);
  }
  const mustIncludeWords = new Set<number>();
  for (const level of JLPT_LEVELS) {
    if (presentLevels.has(level)) continue;
    const candidates = wordsAll
      .filter((w) => w.jlptLevel === level && neighbours(wordEntryId(w.entSeq)).length > 0)
      .sort((a, b) => a.entSeq - b.entSeq);
    const rep = candidates[0];
    if (!rep) {
      console.warn(`warning: no linked word found for JLPT level ${level}`);
      continue;
    }
    mustIncludeWords.add(rep.entSeq);
    // Pull in one of its neighbours too, so it is never isolated.
    const partner = neighbours(wordEntryId(rep.entSeq))[0];
    if (partner?.startsWith('k:')) neighbourKanji.add(partner.slice(2));
    else if (partner?.startsWith('w:')) neighbourWords.add(Number.parseInt(partner.slice(2), 10));
    console.log(`  JLPT ${level}: added w:${rep.entSeq} (${rep.surface}/${rep.reading})`);
  }

  // --- cap: keep base + JLPT reps unconditionally, fill the rest deterministically ---
  const freqRank = (literal: string): number => kanjiByLiteral.get(literal)?.frequency ?? Number.MAX_SAFE_INTEGER;
  const kanjiFinal = new Set<string>(baseKanji);
  for (const literal of [...neighbourKanji].sort((a, b) => freqRank(a) - freqRank(b))) {
    if (kanjiFinal.size >= KANJI_CAP) break;
    kanjiFinal.add(literal);
  }

  const wordsFinal = new Set<number>(mustIncludeWords);
  const rankWord = (entSeq: number): [number, number] => {
    const w = wordByEntSeq.get(entSeq);
    return [w?.isCommon ? 0 : 1, entSeq];
  };
  const remainingBase = [...baseWords]
    .filter((s) => !wordsFinal.has(s))
    .sort((a, b) => {
      const ra = rankWord(a);
      const rb = rankWord(b);
      return ra[0] - rb[0] || ra[1] - rb[1];
    });
  for (const entSeq of remainingBase) {
    if (wordsFinal.size >= WORD_CAP) break;
    wordsFinal.add(entSeq);
  }
  const remainingNeighbours = [...neighbourWords]
    .filter((s) => !wordsFinal.has(s))
    .sort((a, b) => {
      const ra = rankWord(a);
      const rb = rankWord(b);
      return ra[0] - rb[0] || ra[1] - rb[1];
    });
  for (const entSeq of remainingNeighbours) {
    if (wordsFinal.size >= WORD_CAP) break;
    wordsFinal.add(entSeq);
  }
  console.log(`after cap: ${kanjiFinal.size} kanji, ${wordsFinal.size} words`);

  /**
   * Recomputes hubs + memberships restricted to `ids`: a hub survives
   * only if at least two of its full-dataset members are still in the
   * subset, and its memberCount is recomputed from the subset's own
   * membership rows (never copied from the full dataset), so seed
   * counts stay exact.
   */
  function recomputeHubs(ids: ReadonlySet<string>): { hubs: HubRecord[]; members: HubMemberRecord[] } {
    const hubs: HubRecord[] = [];
    const members: HubMemberRecord[] = [];
    for (const [hubId, allMembers] of membersByHub) {
      const survivors = allMembers.filter((m) => ids.has(m.entryId));
      if (survivors.length < 2) continue;
      const source = hubByHubId.get(hubId);
      if (!source) continue;
      hubs.push({ hubId, kind: source.kind, label: source.label, memberCount: survivors.length });
      for (const m of survivors) members.push(m);
    }
    return { hubs, members };
  }

  // --- keep only links whose both ends survived, and recompute hubs for the subset ---
  const idsInSubset = new Set<string>([
    ...[...kanjiFinal].map(kanjiEntryId),
    ...[...wordsFinal].map(wordEntryId),
  ]);
  let subsetLinks = linksAll.filter(
    (l) => idsInSubset.has(l.fromEntryId) && idsInSubset.has(l.toEntryId),
  );
  let subsetHubs = recomputeHubs(idsInSubset);

  // --- drop isolated entries iteratively until none remain. An entry is
  // connected if it has a pairwise link (either direction) OR belongs to
  // a hub with two or more surviving members - dropping an entry can
  // shrink another hub below two members, so this repeats until stable. ---
  const kanjiSet = new Set(kanjiFinal);
  const wordSet = new Set(wordsFinal);
  for (let pass = 0; pass < 10; pass += 1) {
    const connected = new Set<string>();
    for (const l of subsetLinks) {
      connected.add(l.fromEntryId);
      connected.add(l.toEntryId);
    }
    for (const m of subsetHubs.members) connected.add(m.entryId);

    const isolatedKanji = [...kanjiSet].filter((c) => !connected.has(kanjiEntryId(c)));
    const isolatedWords = [...wordSet].filter((s) => !connected.has(wordEntryId(s)));
    if (isolatedKanji.length === 0 && isolatedWords.length === 0) break;
    console.log(
      `pass ${pass}: dropping ${isolatedKanji.length} isolated kanji, ${isolatedWords.length} isolated words`,
    );
    for (const c of isolatedKanji) kanjiSet.delete(c);
    for (const s of isolatedWords) wordSet.delete(s);
    const ids = new Set<string>([...[...kanjiSet].map(kanjiEntryId), ...[...wordSet].map(wordEntryId)]);
    subsetLinks = subsetLinks.filter((l) => ids.has(l.fromEntryId) && ids.has(l.toEntryId));
    subsetHubs = recomputeHubs(ids);
  }

  const finalConnected = new Set<string>();
  for (const l of subsetLinks) {
    finalConnected.add(l.fromEntryId);
    finalConnected.add(l.toEntryId);
  }
  for (const m of subsetHubs.members) finalConnected.add(m.entryId);
  const stillIsolated = [
    ...[...kanjiSet].filter((c) => !finalConnected.has(kanjiEntryId(c))),
    ...[...wordSet].filter((s) => !finalConnected.has(wordEntryId(s))).map(String),
  ];
  if (stillIsolated.length > 0) {
    throw new Error(`seed stage: could not eliminate isolated entries: ${stillIsolated.join(', ')}`);
  }

  const kanjiRows = [...kanjiSet].map((c) => kanjiByLiteral.get(c)).filter((k): k is Kanji => Boolean(k));
  const wordRows = [...wordSet].map((s) => wordByEntSeq.get(s)).filter((w): w is VocabularyItem => Boolean(w));

  const radicalChars = new Set(kanjiRows.map((k) => k.radical).filter((r): r is string => Boolean(r)));
  const componentChars = new Set(kanjiRows.flatMap((k) => k.components));
  const radicalRows = radicalsAll.filter((r) => radicalChars.has(r.character));
  const componentRows = componentsAll.filter((c) => componentChars.has(c.character));

  const levelsCovered = new Set(wordRows.map((w) => w.jlptLevel).filter(Boolean));
  console.log(
    `\nfinal seed: ${kanjiRows.length} kanji, ${wordRows.length} words, ${subsetLinks.length} links, ` +
      `${subsetHubs.hubs.length} hubs, ${subsetHubs.members.length} hub memberships`,
  );
  console.log(`JLPT levels covered by words: ${[...levelsCovered].sort().join(', ')}`);
  for (const level of JLPT_LEVELS) {
    if (!levelsCovered.has(level)) {
      throw new Error(`seed stage: no word at JLPT level ${level} made it into the final seed`);
    }
  }

  console.log('\nwriting data/seed/*.jsonl ...');
  await writeAll(SEED.kanji, kanjiRows);
  await writeAll(SEED.words, wordRows);
  await writeAll(SEED.radicals, radicalRows);
  await writeAll(SEED.components, componentRows);
  await writeAll(SEED.links, subsetLinks);
  await writeAll(SEED.hubs, subsetHubs.hubs);
  await writeAll(SEED.hubMembers, subsetHubs.members);

  console.log('\nseed stage complete. Run `pnpm --filter pipeline exec tsx src/stages/6_load.ts --dir=seed` to load it.');
}

async function writeAll(path: string, records: unknown[]): Promise<void> {
  const writer = new JsonlWriter(path);
  await writer.open();
  for (const rec of records) await writer.write(rec);
  await writer.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
