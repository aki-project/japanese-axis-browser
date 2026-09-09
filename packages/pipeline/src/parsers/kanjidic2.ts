/**
 * Streams kanjidic2.xml.gz through sax and yields one plain record per
 * <character>. Never loaded as a DOM.
 */
import sax from 'sax';
import { gunzipFile } from './gunzipFile.js';

export interface Kanjidic2CodePoint {
  type: string;
  value: string;
}

export interface Kanjidic2Radical {
  type: string;
  value: number;
}

export interface Kanjidic2Reading {
  type: string;
  value: string;
}

export interface Kanjidic2Meaning {
  lang: string | null;
  text: string;
}

export interface Kanjidic2Character {
  literal: string;
  codepoints: Kanjidic2CodePoint[];
  radicals: Kanjidic2Radical[];
  grade: number | null;
  strokeCount: number;
  freq: number | null;
  jlpt: number | null;
  readings: Kanjidic2Reading[];
  meanings: Kanjidic2Meaning[];
  nanori: string[];
}

export async function* parseKanjidic2(gzPath: string): AsyncGenerator<Kanjidic2Character> {
  const parser = sax.createStream(false, { trim: false, lowercase: true });

  let char: Kanjidic2Character | null = null;
  let text = '';
  let inHeader = false;
  let currentReadingType: string | null = null;
  let currentMeaningLang: string | null = null;
  let firstStrokeCountSeen = false;

  const queue: Kanjidic2Character[] = [];
  let ended = false;
  let parseError: Error | null = null;

  parser.on('error', (err) => {
    parseError = err instanceof Error ? err : new Error(String(err));
  });

  parser.on('opentag', (node) => {
    text = '';
    switch (node.name) {
      case 'header':
        inHeader = true;
        break;
      case 'character':
        char = {
          literal: '',
          codepoints: [],
          radicals: [],
          grade: null,
          strokeCount: 0,
          freq: null,
          jlpt: null,
          readings: [],
          meanings: [],
          nanori: [],
        };
        firstStrokeCountSeen = false;
        break;
      case 'cp_value':
        currentReadingType = (node.attributes['cp_type'] as string | undefined) ?? '';
        break;
      case 'rad_value':
        currentReadingType = (node.attributes['rad_type'] as string | undefined) ?? '';
        break;
      case 'reading':
        currentReadingType = (node.attributes['r_type'] as string | undefined) ?? '';
        break;
      case 'meaning':
        currentMeaningLang = (node.attributes['m_lang'] as string | undefined) ?? null;
        break;
      default:
        break;
    }
  });

  parser.on('text', (t) => {
    text += t;
  });

  parser.on('closetag', (name) => {
    switch (name) {
      case 'header':
        inHeader = false;
        break;
      case 'literal':
        if (char && !inHeader) char.literal = text.trim();
        break;
      case 'cp_value':
        if (char) char.codepoints.push({ type: currentReadingType ?? '', value: text.trim() });
        break;
      case 'rad_value':
        if (char) {
          char.radicals.push({
            type: currentReadingType ?? '',
            value: Number.parseInt(text.trim(), 10),
          });
        }
        break;
      case 'grade':
        if (char) char.grade = Number.parseInt(text.trim(), 10);
        break;
      case 'stroke_count':
        // Only the first stroke_count is the character's own count;
        // subsequent ones (rare) describe common miscounts.
        if (char && !firstStrokeCountSeen) {
          char.strokeCount = Number.parseInt(text.trim(), 10);
          firstStrokeCountSeen = true;
        }
        break;
      case 'freq':
        if (char) char.freq = Number.parseInt(text.trim(), 10);
        break;
      case 'jlpt':
        if (char) char.jlpt = Number.parseInt(text.trim(), 10);
        break;
      case 'reading':
        if (char) char.readings.push({ type: currentReadingType ?? '', value: text.trim() });
        currentReadingType = null;
        break;
      case 'meaning':
        if (char && text.trim().length > 0) {
          char.meanings.push({ lang: currentMeaningLang, text: text.trim() });
        }
        currentMeaningLang = null;
        break;
      case 'nanori':
        if (char) char.nanori.push(text.trim());
        break;
      case 'character':
        if (char) queue.push(char);
        char = null;
        break;
      default:
        break;
    }
    text = '';
  });

  parser.on('end', () => {
    ended = true;
  });

  const source = gunzipFile(gzPath);
  source.on('error', (err) => {
    parseError = err instanceof Error ? err : new Error(String(err));
  });
  source.pipe(parser as unknown as NodeJS.WritableStream);

  while (!ended || queue.length > 0) {
    if (parseError) throw parseError;
    const next = queue.shift();
    if (next) {
      yield next;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  if (parseError) throw parseError;
}
