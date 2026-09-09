import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseKanjidic2, type Kanjidic2Character } from './kanjidic2.js';

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<kanjidic2>
<header>
<file_version>4</file_version>
<database_version>2024-01</database_version>
<date_of_creation>2024-01-01</date_of_creation>
</header>
<character>
<literal>日</literal>
<codepoint>
<cp_value cp_type="ucs">65e5</cp_value>
</codepoint>
<radical>
<rad_value rad_type="classical">72</rad_value>
</radical>
<misc>
<grade>1</grade>
<stroke_count>4</stroke_count>
<freq>1</freq>
<jlpt>4</jlpt>
</misc>
<reading_meaning>
<rmgroup>
<reading r_type="ja_on">ニチ</reading>
<reading r_type="ja_kun">ひ</reading>
<meaning>day</meaning>
<meaning>sun</meaning>
</rmgroup>
</reading_meaning>
</character>
<character>
<literal>亜</literal>
<codepoint>
<cp_value cp_type="ucs">4e9c</cp_value>
</codepoint>
<radical>
<rad_value rad_type="classical">7</rad_value>
</radical>
<misc>
<stroke_count>7</stroke_count>
<stroke_count>8</stroke_count>
</misc>
<reading_meaning>
<rmgroup>
<reading r_type="ja_on">ア</reading>
<meaning>Asia</meaning>
<meaning m_lang="fr">Asie</meaning>
</rmgroup>
</reading_meaning>
</character>
</kanjidic2>
`;

let fixtureDir: string;
let fixturePath: string;
let characters: Kanjidic2Character[];

beforeAll(async () => {
  fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'kanjidic2-fixture-'));
  fixturePath = path.join(fixtureDir, 'fixture.gz');
  writeFileSync(fixturePath, gzipSync(Buffer.from(FIXTURE_XML, 'utf8')));
  characters = [];
  for await (const char of parseKanjidic2(fixturePath)) {
    characters.push(char);
  }
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('parseKanjidic2', () => {
  it('does not treat the header as a character', () => {
    expect(characters).toHaveLength(2);
  });

  it('parses jlpt when present', () => {
    expect(characters[0]?.jlpt).toBe(4);
  });

  it('leaves jlpt null for a kanji with no <jlpt> element', () => {
    expect(characters[1]?.jlpt).toBeNull();
  });

  it('keeps only the first stroke_count when more than one is present', () => {
    expect(characters[1]?.strokeCount).toBe(7);
  });

  it('keeps meanings with their language, defaulting to null (English)', () => {
    expect(characters[1]?.meanings).toEqual([
      { lang: null, text: 'Asia' },
      { lang: 'fr', text: 'Asie' },
    ]);
  });
});
