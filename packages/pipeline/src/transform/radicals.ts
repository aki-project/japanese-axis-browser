import type { Radical } from '@japanesesite/shared';
import type { RadkfileEntry } from '../parsers/radkfile.js';
import { KANGXI_RADICALS } from '../lib/kangxiRadicals.js';

const NAME_BY_CHARACTER: ReadonlyMap<string, string> = new Map(
  KANGXI_RADICALS.map((r) => [r.character, `radical ${r.number}`]),
);

/** Radicals from RADKFILE's "$ <radical> <stroke_count>" header lines. */
export function transformRadicals(entries: RadkfileEntry[]): Radical[] {
  const seen = new Set<string>();
  const radicals: Radical[] = [];
  for (const entry of entries) {
    if (!entry.radical || seen.has(entry.radical)) continue;
    seen.add(entry.radical);
    radicals.push({
      character: entry.radical,
      name: NAME_BY_CHARACTER.get(entry.radical) ?? '',
      strokeCount: entry.strokeCount > 0 ? entry.strokeCount : 1,
    });
  }
  return radicals;
}
