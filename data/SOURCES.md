# Data sources

Every dataset below is downloaded into `data/raw/` (gitignored) by
`pnpm --filter pipeline download` and is not committed. This file is the
canonical record of what was downloaded, when, under what licence, and
what attribution the licence requires.

## JMdict (English glosses)

- **File:** `JMdict_e.gz`
- **Source:** http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
- **Downloaded:** 2026-09-08
- **Licence:** Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0), copyright the Electronic Dictionary Research and Development Group (EDRDG) at Monash University.
- **Attribution:** "This site uses the JMdict dictionary file. This is the property of the Electronic Dictionary Research and Development Group, and is used in conformance with the Group's licence." See https://www.edrdg.org/edrdg/licence.html.
- **Used for:** VocabularyItem records (surface, reading, alternates, meanings, parts of speech, is_common), and as the source of `xref`/`ant` cross-reference data for semantic links.

## KANJIDIC2

- **File:** `kanjidic2.xml.gz`
- **Source:** http://www.edrdg.org/kanjidic/kanjidic2.xml.gz
- **Downloaded:** 2026-09-08
- **Licence:** CC BY-SA 4.0, copyright EDRDG (same group/licence as JMdict).
- **Attribution:** "This site uses the KANJIDIC2 dictionary file. This is the property of the Electronic Dictionary Research and Development Group, and is used in conformance with the Group's licence." See https://www.edrdg.org/edrdg/licence.html.
- **Used for:** Kanji records (on/kun readings, meanings, stroke count, classical radical number, frequency, old-scale JLPT level).

## KRADFILE / RADKFILE

- **Files:** `kradfile.gz`, `radkfile.gz`
- **Source:** http://ftp.edrdg.org/pub/Nihongo/kradfile.gz, http://ftp.edrdg.org/pub/Nihongo/radkfile.gz
- **Downloaded:** 2026-09-08
- **Licence:** CC BY-SA 4.0, copyright EDRDG.
- **Attribution:** "This site uses the KRADFILE/RADKFILE data files. These are the property of the Electronic Dictionary Research and Development Group, and are used in conformance with the Group's licence." See https://www.edrdg.org/edrdg/licence.html.
- **Encoding:** EUC-JP as distributed; decoded with `TextDecoder('euc-jp')`.
- **Used for:** `kanji.radical` (KANJIDIC2's classical radical number, mapped to a character via the Kangxi radical table, is preferred; KRADFILE's first listed component is only a fallback for the rare kanji with no classical radical number at all - KRADFILE is a *visual* decomposition into on-screen components, not a radical-first breakdown, so its first element is frequently not the actual radical, e.g. 阿's first KRADFILE component is ｜, not its real radical 阜), the `radicals` table (from RADKFILE's `$ <radical> <stroke_count>` header lines), and the `shared_radical` structural link.

## IDS (Ideographic Description Sequence) decomposition data

- **File:** `ids.txt`
- **Source:** https://raw.githubusercontent.com/cjkvi/cjkvi-ids/master/ids.txt (cjkvi-ids project, based on the CHISE IDS database)
- **Downloaded:** 2026-09-08
- **Licence:** GPL-2.0 (the data file itself; see the project's repository for the full licence text and copyright notice reproduced at the top of the file).
- **Attribution:** "Kanji decomposition data from the cjkvi-ids project (GPL-2.0), based on the CHISE IDS Database."
- **Used for:** `kanji.components` (first IDS sequence per character, flattened one level, IDC operators stripped, kept only when a component is itself a KANJIDIC2 kanji or a RADKFILE radical shape), and the `has_component`/`component_of`/`shared_phonetic_component` structural links.

## Japanese WordNet

- **File:** `wnjpn-ok.tab.gz` (tab export; a `.db.gz` SQLite fallback is supported by `download`/`parse` if the tab file is ever pulled from the release page, read via Node's built-in `node:sqlite`, but was not needed here - the tab file downloaded successfully)
- **Source:** https://github.com/bond-lab/wnja/releases/download/v1.1/wnjpn-ok.tab.gz
- **Downloaded:** 2026-09-08
- **Licence:** Japanese WordNet Licence (NICT / Bond Lab), a Creative Commons Attribution 4.0-style licence requiring attribution to the Japanese WordNet project.
- **Attribution:** "This site uses the Japanese WordNet (http://compling.hss.ntu.edu.sg/wnja/), developed by the National Institute of Information and Communications Technology (NICT), Japan, licensed under the Japanese WordNet Licence."
- **Used for:** `synonym` semantic links (words sharing a WordNet synset).

## jlpt-word-list

- **Files:** `jlpt-n5.csv` .. `jlpt-n1.csv`
- **Source:** https://github.com/elzup/jlpt-word-list (raw CSVs under `src/n5.csv` .. `src/n1.csv`)
- **Downloaded:** 2026-09-08
- **Licence:** As published in the `elzup/jlpt-word-list` GitHub repository (community-maintained, unofficial list; treated here as an approximate JLPT-level signal, not an authoritative source - the repository itself notes the levels are best-effort).
- **Attribution:** "JLPT level approximations from the elzup/jlpt-word-list project (community-maintained, unofficial)."
- **Used for:** `vocabularyItem.jlptLevel`, matched to JMdict entries by exact (surface, reading), falling back to reading-only for entries with no kanji form. Also used to decide which non-common JMdict entries are kept once the word count needed tightening (see below).

## Sentences (Tatoeba) — deferred

The Sentence entity and Tatoeba import are explicitly out of scope for
this build (`src/stages/8_sentences.ts` is a stub that logs "skipped" and
exits 0). No Tatoeba data was downloaded. `sentences` and
`sentence_entries` remain empty tables.

## Furigana segmentation

Not applicable yet - no sentence data has been processed, so no
segmenter has been used. When the Sentence stage is implemented, this
file must record which segmenter (e.g. `kuromoji`/`sudachi`) produced
the `{ base, reading }[]` alignment.

## Notes on derived filtering

- KANJIDIC2 covers 13,108 kanji. Of those, any kanji with zero readings
  AND zero meanings is dropped from the kanji output entirely (it is
  unusable as an entry - no reading, no gloss, nothing to show); a kanji
  that is readingless-and-meaningless is still treated as a plain,
  non-kanji component if it ever shows up inside another kanji's IDS
  decomposition, exactly like any other unrecognised component shape.
  Kanji with readings but no English meaning (a few thousand rare JIS X
  0212/0213 characters) are kept.
- JMdict covers 218,740 entries. Keeping every entry that is common, has
  a JLPT level, or is written entirely in kanji already in KANJIDIC2
  produced 130,480 words, which is well over the 60,000 ceiling from the
  brief; the filter was tightened to common-or-JLPT-only, producing
  30,437 words. This is recorded in the transform stage's own log
  output as well as here.
- **KANJIDIC2's old 4-level JLPT scale has a hole at N3 for kanji.** The
  old scale only ever had 4 buckets (mapped here as 4->N5, 3->N4, 2->N2,
  1->N1); level "2" is documented by EDRDG as covering what later became
  both N3 and N2 in the current 5-level JLPT, and KANJIDIC2 does not
  record which of the two a given level-2 kanji belongs to. Rather than
  guess a split, `kanji.jlptLevel` is simply left `null` for every kanji
  whose real-world level is N3 - there is no reliable per-kanji N3
  signal in this source. (Words do not have this problem: their JLPT
  level comes from the separately-leveled jlpt-word-list CSVs, one file
  per N5..N1.)
