/**
 * Stage 1: download. Fetches raw sources into data/raw/. Skips a file
 * that already exists unless --force is passed. Idempotent: re-running
 * without --force is a no-op when everything is already downloaded.
 */
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { RAW, RAW_DIR } from '../lib/paths.js';

interface DownloadTarget {
  name: string;
  url: string;
  dest: string;
}

const JLPT_LEVELS = ['n5', 'n4', 'n3', 'n2', 'n1'] as const;

const TARGETS: DownloadTarget[] = [
  { name: 'JMdict_e', url: 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz', dest: RAW.jmdict },
  {
    name: 'KANJIDIC2',
    url: 'http://www.edrdg.org/kanjidic/kanjidic2.xml.gz',
    dest: RAW.kanjidic2,
  },
  { name: 'KRADFILE', url: 'http://ftp.edrdg.org/pub/Nihongo/kradfile.gz', dest: RAW.kradfile },
  { name: 'RADKFILE', url: 'http://ftp.edrdg.org/pub/Nihongo/radkfile.gz', dest: RAW.radkfile },
  {
    name: 'IDS decomposition',
    url: 'https://raw.githubusercontent.com/cjkvi/cjkvi-ids/master/ids.txt',
    dest: RAW.ids,
  },
  {
    name: 'Japanese WordNet (tab)',
    url: 'https://github.com/bond-lab/wnja/releases/download/v1.1/wnjpn-ok.tab.gz',
    dest: RAW.wordnetTab,
  },
  ...JLPT_LEVELS.map((level) => ({
    name: `jlpt-word-list ${level}`,
    url: `https://github.com/elzup/jlpt-word-list/raw/master/src/${level}.csv`,
    dest: RAW.jlpt(level),
  })),
];

async function downloadOne(target: DownloadTarget, force: boolean): Promise<void> {
  if (!force && existsSync(target.dest)) {
    console.log(`skip (exists): ${target.name} -> ${target.dest}`);
    return;
  }
  console.log(`downloading: ${target.name} <- ${target.url}`);
  const res = await fetch(target.url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed for ${target.name}: HTTP ${res.status} ${target.url}`);
  }
  const out = createWriteStream(target.dest);
  await finished(Readable.fromWeb(res.body as never).pipe(out));
  console.log(`  saved -> ${target.dest}`);
}

async function main(): Promise<void> {
  mkdirSync(RAW_DIR, { recursive: true });
  const force = process.argv.includes('--force');

  let failures = 0;
  for (const target of TARGETS) {
    try {
      await downloadOne(target, force);
    } catch (err) {
      failures += 1;
      console.error(`ERROR downloading ${target.name}:`, (err as Error).message);
    }
  }

  console.log(
    `\nJapanese WordNet: if the tab file was unavailable, wnjpn.db.gz must be fetched ` +
      `manually to ${RAW.wordnetDb} and will be read with node:sqlite by the parse stage.`,
  );

  if (failures > 0) {
    console.error(`\n${failures} download(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll downloads complete (or already present).');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
