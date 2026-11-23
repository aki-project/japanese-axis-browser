import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

/**
 * Yields each line of a text stream (or of the file at a path), UTF-8,
 * without the line terminator. Splits on \n and drops a trailing \r, so
 * both LF and CRLF files read the same. A final line with no
 * terminator is still yielded.
 *
 * Use this rather than `for await (const line of readline.createInterface(...))`.
 * readline pauses itself when lines pile up faster than a slow consumer
 * (one that awaits a write per record) takes them; if the input ends
 * meanwhile it closes, and the next iteration throws ERR_USE_AFTER_CLOSE
 * on some Node versions and machines. Iterating the stream directly uses
 * ordinary stream back-pressure instead, and a stream error (a missing
 * file, a corrupt gzip) rejects the loop rather than being lost.
 */
export async function* readLines(input: string | Readable): AsyncGenerator<string> {
  const stream = typeof input === 'string' ? createReadStream(input) : input;
  // Decode in the stream, so a multi-byte character split across two
  // chunks is joined before it reaches the splitting below.
  stream.setEncoding('utf8');
  let carry = '';
  for await (const chunk of stream as AsyncIterable<string>) {
    const parts = (carry + chunk).split('\n');
    carry = parts.pop() ?? '';
    for (const part of parts) yield part.endsWith('\r') ? part.slice(0, -1) : part;
  }
  if (carry.length > 0) yield carry.endsWith('\r') ? carry.slice(0, -1) : carry;
}
