import type { Component } from '@japanesesite/shared';
import type { Kanji } from '@japanesesite/shared';

/**
 * Every character that appears as a component of any kanji.
 * is_kanji reflects whether that character is itself a KANJIDIC2
 * literal; etymology is always null (no source populates it yet).
 */
export function transformComponents(kanjiList: Kanji[], kanjiSet: ReadonlySet<string>): Component[] {
  const seen = new Set<string>();
  const components: Component[] = [];
  for (const k of kanjiList) {
    for (const comp of k.components) {
      if (seen.has(comp)) continue;
      seen.add(comp);
      components.push({ character: comp, isKanji: kanjiSet.has(comp), etymology: null });
    }
  }
  return components;
}
