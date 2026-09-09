import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseJMdict, type JMdictEntry } from './jmdict.js';

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY n "noun">
<!ENTITY exp "expression">
]>
<JMdict>
<entry>
<ent_seq>1000000</ent_seq>
<r_ele>
<reb>ヽ</reb>
</r_ele>
<sense>
<pos>&exp;</pos>
<gloss>repetition mark in katakana</gloss>
</sense>
</entry>
<entry>
<ent_seq>1000230</ent_seq>
<k_ele>
<keb>明かん</keb>
<ke_inf>&rK;</ke_inf>
</k_ele>
<r_ele>
<reb>あかん</reb>
</r_ele>
<r_ele>
<reb>アカン</reb>
<re_nokanji/>
</r_ele>
<sense>
<pos>&exp;</pos>
<xref>明く・1</xref>
<gloss>useless</gloss>
<gloss>no good</gloss>
</sense>
</entry>
</JMdict>
`;

let fixtureDir: string;
let fixturePath: string;
let entries: JMdictEntry[];

beforeAll(async () => {
  fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'jmdict-fixture-'));
  fixturePath = path.join(fixtureDir, 'fixture.gz');
  writeFileSync(fixturePath, gzipSync(Buffer.from(FIXTURE_XML, 'utf8')));
  entries = [];
  for await (const entry of parseJMdict(fixturePath)) {
    entries.push(entry);
  }
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('parseJMdict', () => {
  it('parses an entry with no k_ele (kana-only word)', () => {
    const entry = entries.find((e) => e.entSeq === 1000000);
    expect(entry?.kEle).toEqual([]);
    expect(entry?.rEle).toEqual([{ reb: 'ヽ', reNokanji: false, reRestr: [], reInf: [], rePri: [] }]);
  });

  it('parses multiple r_ele readings, including re_nokanji', () => {
    const entry = entries.find((e) => e.entSeq === 1000230);
    expect(entry?.rEle).toHaveLength(2);
    expect(entry?.rEle[0]).toMatchObject({ reb: 'あかん', reNokanji: false });
    expect(entry?.rEle[1]).toMatchObject({ reb: 'アカン', reNokanji: true });
  });

  it('unwraps a custom XML entity used as a <pos> tag down to its bare name', () => {
    const entry = entries.find((e) => e.entSeq === 1000230);
    expect(entry?.sense[0]?.pos).toEqual(['exp']);
  });

  it('keeps ke_inf entity text and xref text as separate fields', () => {
    const entry = entries.find((e) => e.entSeq === 1000230);
    expect(entry?.kEle[0]?.keInf).toEqual(['rK']);
    expect(entry?.sense[0]?.xref).toEqual(['明く・1']);
  });
});
