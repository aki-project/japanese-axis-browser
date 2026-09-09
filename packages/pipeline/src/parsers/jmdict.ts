/**
 * Streams JMdict_e.gz through sax (never loaded as a DOM) and yields one
 * plain record per <entry>. JMdict declares hundreds of custom XML
 * entities (&n;, &v5r;, &exp; ...) in its internal DTD subset, which sax
 * does not parse; in non-strict mode unresolved entities come through
 * verbatim as "&name;" text, and we strip the punctuation to recover the
 * entity name. No semantic mapping happens here - that is the transform
 * stage's job.
 */
import sax from 'sax';
import { gunzipFile } from './gunzipFile.js';

export interface JMdictKEle {
  keb: string;
  keInf: string[];
  kePri: string[];
}

export interface JMdictREle {
  reb: string;
  reNokanji: boolean;
  reRestr: string[];
  reInf: string[];
  rePri: string[];
}

export interface JMdictGloss {
  lang: string | null;
  text: string;
}

export interface JMdictSense {
  pos: string[];
  xref: string[];
  ant: string[];
  field: string[];
  misc: string[];
  dial: string[];
  sInf: string[];
  gloss: JMdictGloss[];
}

export interface JMdictEntry {
  entSeq: number;
  kEle: JMdictKEle[];
  rEle: JMdictREle[];
  sense: JMdictSense[];
}

const ENTITY_RE = /^&([a-zA-Z0-9_-]+);$/;

/** Strips a bare custom-entity reference like "&exp;" down to "exp". */
function unwrapEntity(text: string): string {
  const m = ENTITY_RE.exec(text.trim());
  return m ? (m[1] as string) : text.trim();
}

export async function* parseJMdict(gzPath: string): AsyncGenerator<JMdictEntry> {
  const parser = sax.createStream(false, { trim: false, lowercase: true });

  let entry: JMdictEntry | null = null;
  let kEle: JMdictKEle | null = null;
  let rEle: JMdictREle | null = null;
  let sense: JMdictSense | null = null;
  let text = '';
  let glossLang: string | null = null;

  const queue: JMdictEntry[] = [];
  let ended = false;
  let parseError: Error | null = null;

  parser.on('error', (err) => {
    parseError = err instanceof Error ? err : new Error(String(err));
  });

  parser.on('opentag', (node) => {
    text = '';
    switch (node.name) {
      case 'entry':
        entry = { entSeq: 0, kEle: [], rEle: [], sense: [] };
        break;
      case 'k_ele':
        kEle = { keb: '', keInf: [], kePri: [] };
        break;
      case 'r_ele':
        rEle = { reb: '', reNokanji: false, reRestr: [], reInf: [], rePri: [] };
        break;
      case 'sense':
        sense = { pos: [], xref: [], ant: [], field: [], misc: [], dial: [], sInf: [], gloss: [] };
        break;
      case 'gloss':
        glossLang = (node.attributes['xml:lang'] as string | undefined) ?? null;
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
      case 'ent_seq':
        if (entry) entry.entSeq = Number.parseInt(text.trim(), 10);
        break;
      case 'keb':
        if (kEle) kEle.keb = text.trim();
        break;
      case 'ke_inf':
        if (kEle) kEle.keInf.push(unwrapEntity(text));
        break;
      case 'ke_pri':
        if (kEle) kEle.kePri.push(text.trim());
        break;
      case 'k_ele':
        if (entry && kEle) entry.kEle.push(kEle);
        kEle = null;
        break;
      case 'reb':
        if (rEle) rEle.reb = text.trim();
        break;
      case 're_nokanji':
        if (rEle) rEle.reNokanji = true;
        break;
      case 're_restr':
        if (rEle) rEle.reRestr.push(text.trim());
        break;
      case 're_inf':
        if (rEle) rEle.reInf.push(unwrapEntity(text));
        break;
      case 're_pri':
        if (rEle) rEle.rePri.push(text.trim());
        break;
      case 'r_ele':
        if (entry && rEle) entry.rEle.push(rEle);
        rEle = null;
        break;
      case 'pos':
        if (sense) sense.pos.push(unwrapEntity(text));
        break;
      case 'xref':
        if (sense) sense.xref.push(text.trim());
        break;
      case 'ant':
        if (sense) sense.ant.push(text.trim());
        break;
      case 'field':
        if (sense) sense.field.push(unwrapEntity(text));
        break;
      case 'misc':
        if (sense) sense.misc.push(unwrapEntity(text));
        break;
      case 'dial':
        if (sense) sense.dial.push(unwrapEntity(text));
        break;
      case 's_inf':
        if (sense) sense.sInf.push(text.trim());
        break;
      case 'gloss':
        if (sense && text.trim().length > 0) {
          sense.gloss.push({ lang: glossLang, text: text.trim() });
        }
        glossLang = null;
        break;
      case 'sense':
        if (entry && sense) entry.sense.push(sense);
        sense = null;
        break;
      case 'entry':
        if (entry) queue.push(entry);
        entry = null;
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

  // Drain the queue as it fills, backpressure-free since entries are small.
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
