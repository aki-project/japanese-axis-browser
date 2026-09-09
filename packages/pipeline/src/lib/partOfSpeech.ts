import type { PartOfSpeech } from '@japanesesite/shared';

/**
 * Maps a JMdict <pos> entity name onto our fixed PARTS_OF_SPEECH list.
 * Written rule (CLAUDE.md order): n(-*) -> noun; v1, v5-anything, vs-anything,
 * aux-v (and other verb codes) -> verb; adj-i/adj-ix -> i-adjective;
 * adj-na -> na-adjective; adv(-to) -> adverb; prt -> particle; conj ->
 * conjunction; pn -> pronoun; ctr -> counter; exp -> expression; pref ->
 * prefix; suf -> suffix; anything else -> other.
 */
export function mapPartOfSpeech(pos: string): PartOfSpeech {
  if (pos === 'n' || pos.startsWith('n-')) return 'noun';
  if (
    pos.startsWith('v1') ||
    pos.startsWith('v5') ||
    pos.startsWith('vs') ||
    pos === 'aux-v' ||
    pos.startsWith('v')
  )
    return 'verb';
  if (pos === 'adj-i' || pos === 'adj-ix') return 'i-adjective';
  if (pos === 'adj-na') return 'na-adjective';
  if (pos === 'adv' || pos.startsWith('adv-')) return 'adverb';
  if (pos === 'prt') return 'particle';
  if (pos === 'conj') return 'conjunction';
  if (pos === 'pn') return 'pronoun';
  if (pos === 'ctr') return 'counter';
  if (pos === 'exp') return 'expression';
  if (pos === 'pref') return 'prefix';
  if (pos === 'suf') return 'suffix';
  return 'other';
}
