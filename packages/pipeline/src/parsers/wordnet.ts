/**
 * Japanese WordNet tab export (wnjpn-ok.tab.gz): columns
 * synset<TAB>lemma<TAB>source ("hand"-checked, "mono"-lingual, "auto").
 */
import readline from 'node:readline';
import { gunzipFile } from './gunzipFile.js';

export interface WordnetEntry {
  synset: string;
  lemma: string;
  source: string;
}

export async function* parseWordnet(gzPath: string): AsyncGenerator<WordnetEntry> {
  const stream = gunzipFile(gzPath);
  // readline does not reliably proxy the input stream's 'error' event
  // through its own async iterator, so track it ourselves and check it
  // after the loop - a missing/corrupt raw file must fail the stage
  // instead of silently yielding a truncated file.
  let streamError: Error | null = null;
  stream.on('error', (err) => {
    streamError = err instanceof Error ? err : new Error(String(err));
  });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (streamError) throw streamError;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const [synset, lemma, source] = trimmed.split('\t');
    if (!synset || !lemma) continue;
    yield { synset, lemma, source: source ?? '' };
  }
  if (streamError) throw streamError;
}
