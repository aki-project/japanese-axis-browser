import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

/** Ensures the parent directory of `filePath` exists. */
export function ensureDirFor(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

/**
 * Streams a JSON Lines file, yielding one parsed record per non-empty
 * line. Always opened with explicit UTF-8 decoding.
 */
export async function* readJsonl<T = unknown>(filePath: string): AsyncGenerator<T> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    yield JSON.parse(trimmed) as T;
  }
}

/** Reads an entire JSON Lines file into an array. Fine for our data sizes. */
export async function readJsonlAll<T = unknown>(filePath: string): Promise<T[]> {
  const out: T[] = [];
  for await (const rec of readJsonl<T>(filePath)) {
    out.push(rec);
  }
  return out;
}

/**
 * Writer that appends newline-delimited JSON records to a file, UTF-8,
 * created fresh (truncated) on open so re-running a stage is
 * idempotent rather than appending duplicates. Buffers records and
 * flushes in batches - with millions of links, awaiting one tiny
 * `write()` syscall per record is the dominant cost of a run.
 */
const FLUSH_EVERY = 2000;

export class JsonlWriter {
  private handle: FileHandle | null = null;
  private readonly filePath: string;
  private buffer: string[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async open(): Promise<void> {
    ensureDirFor(this.filePath);
    this.handle = await open(this.filePath, 'w');
  }

  async write(record: unknown): Promise<void> {
    if (!this.handle) throw new Error(`JsonlWriter not opened: ${this.filePath}`);
    this.buffer.push(JSON.stringify(record));
    if (this.buffer.length >= FLUSH_EVERY) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (!this.handle || this.buffer.length === 0) return;
    const chunk = this.buffer.join('\n') + '\n';
    this.buffer = [];
    await this.handle.write(chunk, null, 'utf8');
  }

  async close(): Promise<void> {
    await this.flush();
    await this.handle?.close();
    this.handle = null;
  }
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}
