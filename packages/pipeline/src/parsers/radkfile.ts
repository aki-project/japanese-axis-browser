/**
 * RADKFILE: EUC-JP encoded. A radical entry starts with a line
 * "$ <radical> <stroke_count> [<radical_alt>]" followed by one or more
 * lines listing every kanji that contains that radical as a component.
 */
import { gunzipFile } from './gunzipFile.js';

export interface RadkfileEntry {
  radical: string;
  strokeCount: number;
  kanji: string[];
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

export async function* parseRadkfile(gzPath: string): AsyncGenerator<RadkfileEntry> {
  const text = await decodeEucJp(gzPath);
  let current: RadkfileEntry | null = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('$')) {
      if (current) yield current;
      const parts = trimmed.slice(1).trim().split(/\s+/u);
      const radical = parts[0] ?? '';
      const strokeCount = Number.parseInt(parts[1] ?? '0', 10);
      current = { radical, strokeCount, kanji: [] };
    } else if (current) {
      current.kanji.push(...Array.from(trimmed).filter((ch) => !/\s/u.test(ch)));
    }
  }
  if (current) yield current;
}
