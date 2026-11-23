/**
 * jlpt-word-list CSVs: header "expression,reading,meaning,tags", with
 * meaning sometimes quoted and containing commas. A minimal CSV reader
 * is enough since fields are simple (quotes only wrap the meaning
 * column and never contain escaped quotes in this dataset).
 */
import { readLines } from '../lib/lines.js';

export interface JlptCsvRow {
  level: 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
  expression: string;
  reading: string;
  meaning: string;
  tags: string;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

export async function* parseJlptCsv(
  filePath: string,
  level: JlptCsvRow['level'],
): AsyncGenerator<JlptCsvRow> {
  let first = true;
  for await (const line of readLines(filePath)) {
    if (first) {
      first = false;
      continue; // header
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const fields = splitCsvLine(trimmed);
    const [expression, reading, meaning, tags] = fields;
    if (!expression || !reading) continue;
    yield { level, expression, reading, meaning: meaning ?? '', tags: tags ?? '' };
  }
}
