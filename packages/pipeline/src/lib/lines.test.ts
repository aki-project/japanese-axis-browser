import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { readLines } from './lines.js';

const dir = mkdtempSync(path.join(tmpdir(), 'lines-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function collect(input: Parameters<typeof readLines>[0]): Promise<string[]> {
  const out: string[] = [];
  for await (const line of readLines(input)) out.push(line);
  return out;
}

describe('readLines', () => {
  it('reads LF and CRLF lines alike, including a last line with no terminator', async () => {
    const file = path.join(dir, 'mixed.txt');
    writeFileSync(file, 'a\r\nb\n\nc', 'utf8');
    expect(await collect(file)).toEqual(['a', 'b', '', 'c']);
  });

  it('keeps multi-byte characters and CRLF intact when split across chunks', async () => {
    const bytes = Buffer.from('日本\r\n語', 'utf8');
    // One byte per chunk splits every character and the CRLF pair.
    const chunks = [...bytes].map((b) => Buffer.from([b]));
    expect(await collect(Readable.from(chunks))).toEqual(['日本', '語']);
  });

  it('delivers every line to a slow consumer of a large file', async () => {
    // The shape that broke readline: many lines per chunk, and a
    // consumer that awaits between lines.
    const file = path.join(dir, 'large.txt');
    const count = 100_000;
    writeFileSync(file, Array.from({ length: count }, (_, i) => `line ${i}`).join('\n') + '\n', 'utf8');
    let seen = 0;
    let last = '';
    for await (const line of readLines(file)) {
      if (seen % 5000 === 0) await new Promise((r) => setTimeout(r, 1));
      seen += 1;
      last = line;
    }
    expect(seen).toBe(count);
    expect(last).toBe(`line ${count - 1}`);
  });

  it('rejects when the file cannot be read', async () => {
    await expect(collect(path.join(dir, 'missing.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
