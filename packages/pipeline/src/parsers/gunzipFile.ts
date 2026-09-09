import { createReadStream } from 'node:fs';
import { createGunzip, type Gunzip } from 'node:zlib';

/**
 * Opens a gzipped file for streaming, decompressed. `.pipe()` alone
 * only forwards data/end from source to destination, never 'error' -
 * so a missing/unreadable raw file (ENOENT, permission error, ...)
 * would leave the gunzip stream (and anything reading from it) hanging
 * instead of failing. Forwarding the source's error into the gunzip
 * stream via `.destroy(err)` makes it surface through the normal
 * stream error path (an async-iterator throw, or an 'error' event) so
 * every parser fails cleanly with the real error.
 */
export function gunzipFile(path: string): Gunzip {
  const source = createReadStream(path);
  const gunzip = createGunzip();
  source.on('error', (err) => gunzip.destroy(err));
  source.pipe(gunzip);
  return gunzip;
}
