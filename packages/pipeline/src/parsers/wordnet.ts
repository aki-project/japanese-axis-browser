/**
 * Japanese WordNet tab export (wnjpn-ok.tab.gz): columns
 * synset<TAB>lemma<TAB>source ("hand"-checked, "mono"-lingual, "auto").
 */
import { readLines } from '../lib/lines.js';
import { gunzipFile } from './gunzipFile.js';

export interface WordnetEntry {
  synset: string;
  lemma: string;
  source: string;
}

export async function* parseWordnet(gzPath: string): AsyncGenerator<WordnetEntry> {
  // readLines iterates the stream directly, so a missing or corrupt raw
  // file rejects the loop (gunzipFile forwards the source's error)
  // instead of yielding a silently truncated file.
  for await (const line of readLines(gunzipFile(gzPath))) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const [synset, lemma, source] = trimmed.split('\t');
    if (!synset || !lemma) continue;
    yield { synset, lemma, source: source ?? '' };
  }
}
