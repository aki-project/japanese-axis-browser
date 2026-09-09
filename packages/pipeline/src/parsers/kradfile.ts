/**
 * KRADFILE: EUC-JP encoded. Each non-comment line is
 * "<kanji> : <component> <component> ...".
 */
import { gunzipFile } from './gunzipFile.js';

export interface KradfileEntry {
  character: string;
  components: string[];
}

async function decodeEucJp(gzPath: string): Promise<string> {
  const chunks: Buffer[] = [];
  const stream = gunzipFile(gzPath);
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  const buf = Buffer.concat(chunks);
  return new TextDecoder('euc-jp').decode(buf);
}

export async function* parseKradfile(gzPath: string): AsyncGenerator<KradfileEntry> {
  const text = await decodeEucJp(gzPath);
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const [charPart, compPart] = trimmed.split(':');
    if (!charPart || !compPart) continue;
    const character = charPart.trim();
    const components = compPart.trim().split(/\s+/u).filter(Boolean);
    yield { character, components };
  }
}
