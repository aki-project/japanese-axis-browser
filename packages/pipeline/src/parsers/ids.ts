/**
 * IDS decomposition file (cjkvi-ids): tab-separated lines
 * "U+XXXX<TAB>char<TAB>seq1<TAB>seq2...". Later fields are
 * region-tagged alternate decompositions (e.g. "...[T]"); we keep every
 * sequence as written and let the transform stage pick the primary one.
 * Comment lines start with '#'.
 */
import { createReadStream } from 'node:fs';
import readline from 'node:readline';

export interface IdsEntry {
  codepoint: string;
  character: string;
  sequences: string[];
}

export async function* parseIds(filePath: string): AsyncGenerator<IdsEntry> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const fields = trimmed.split('\t');
    const codepoint = fields[0];
    const character = fields[1];
    if (!codepoint || !character) continue;
    const sequences = fields.slice(2).filter(Boolean);
    yield { codepoint, character, sequences };
  }
}
