import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/lib -> src -> pipeline -> packages -> <repo root>
export const REPO_ROOT = path.resolve(__dirname, '../../../..');

export const RAW_DIR = path.join(REPO_ROOT, 'data', 'raw');
export const PROCESSED_DIR = path.join(REPO_ROOT, 'data', 'processed');
export const SEED_DIR = path.join(REPO_ROOT, 'data', 'seed');

export const RAW = {
  jmdict: path.join(RAW_DIR, 'JMdict_e.gz'),
  kanjidic2: path.join(RAW_DIR, 'kanjidic2.xml.gz'),
  kradfile: path.join(RAW_DIR, 'kradfile.gz'),
  radkfile: path.join(RAW_DIR, 'radkfile.gz'),
  ids: path.join(RAW_DIR, 'ids.txt'),
  wordnetTab: path.join(RAW_DIR, 'wnjpn-ok.tab.gz'),
  wordnetDb: path.join(RAW_DIR, 'wnjpn.db.gz'),
  jlpt: (level: 'n5' | 'n4' | 'n3' | 'n2' | 'n1'): string =>
    path.join(RAW_DIR, `jlpt-${level}.csv`),
};

export const PARSED = {
  jmdict: path.join(PROCESSED_DIR, 'raw-jmdict.jsonl'),
  kanjidic2: path.join(PROCESSED_DIR, 'raw-kanjidic2.jsonl'),
  kradfile: path.join(PROCESSED_DIR, 'raw-kradfile.jsonl'),
  radkfile: path.join(PROCESSED_DIR, 'raw-radkfile.jsonl'),
  ids: path.join(PROCESSED_DIR, 'raw-ids.jsonl'),
  wordnet: path.join(PROCESSED_DIR, 'raw-wordnet.jsonl'),
  jlpt: path.join(PROCESSED_DIR, 'raw-jlpt.jsonl'),
};

export const PROCESSED = {
  kanji: path.join(PROCESSED_DIR, 'kanji.jsonl'),
  words: path.join(PROCESSED_DIR, 'words.jsonl'),
  radicals: path.join(PROCESSED_DIR, 'radicals.jsonl'),
  components: path.join(PROCESSED_DIR, 'components.jsonl'),
  links: path.join(PROCESSED_DIR, 'links.jsonl'),
  hubs: path.join(PROCESSED_DIR, 'hubs.jsonl'),
  hubMembers: path.join(PROCESSED_DIR, 'hub_members.jsonl'),
};

export const SEED = {
  kanji: path.join(SEED_DIR, 'kanji.jsonl'),
  words: path.join(SEED_DIR, 'words.jsonl'),
  radicals: path.join(SEED_DIR, 'radicals.jsonl'),
  components: path.join(SEED_DIR, 'components.jsonl'),
  links: path.join(SEED_DIR, 'links.jsonl'),
  hubs: path.join(SEED_DIR, 'hubs.jsonl'),
  hubMembers: path.join(SEED_DIR, 'hub_members.jsonl'),
};
