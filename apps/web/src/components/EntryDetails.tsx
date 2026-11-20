import type { EntryResponse, Kanji, VocabularyItem } from '@japanesesite/shared';
import { useKnownEntries } from '../hooks/useKnownEntries.js';
import { JlptBadge } from './JlptBadge.js';
import { KnownCheckbox } from './KnownCheckbox.js';
import { SentenceList } from './SentenceList.js';

const KNOWN_HEADLINE = ' text-blue-700';

function KanjiDetails({ kanji, isKnown }: { kanji: Kanji; isKnown: boolean }) {
  return (
    <>
      <p lang="ja" className={`text-7xl leading-none${isKnown ? KNOWN_HEADLINE : ''}`}>
        {kanji.literal}
      </p>
      <JlptBadge level={kanji.jlptLevel} />
      <ul className="text-sm text-slate-700">
        {kanji.meanings.map((meaning) => (
          <li key={meaning}>{meaning}</li>
        ))}
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-left">
        <dt className="font-medium text-slate-500">On readings</dt>
        <dd lang="ja">{kanji.onReadings.length > 0 ? kanji.onReadings.join('、') : '—'}</dd>
        <dt className="font-medium text-slate-500">Kun readings</dt>
        <dd lang="ja">{kanji.kunReadings.length > 0 ? kanji.kunReadings.join('、') : '—'}</dd>
        <dt className="font-medium text-slate-500">Stroke count</dt>
        <dd>{kanji.strokeCount}</dd>
        <dt className="font-medium text-slate-500">Radical</dt>
        <dd lang="ja">{kanji.radical ?? '—'}</dd>
        <dt className="font-medium text-slate-500">Components</dt>
        <dd lang="ja">{kanji.components.length > 0 ? kanji.components.join('、') : '—'}</dd>
      </dl>
    </>
  );
}

function WordDetails({ word, isKnown }: { word: VocabularyItem; isKnown: boolean }) {
  return (
    <>
      <p lang="ja" className={`text-5xl leading-tight${isKnown ? KNOWN_HEADLINE : ''}`}>
        {word.surface}
      </p>
      <p lang="ja" className="text-xl text-slate-500">
        {word.reading}
      </p>
      <JlptBadge level={word.jlptLevel} />
      <ul className="text-sm text-slate-700">
        {word.meanings.map((meaning) => (
          <li key={meaning}>{meaning}</li>
        ))}
      </ul>
      {word.partsOfSpeech.length > 0 ? (
        <p className="text-xs uppercase tracking-wide text-slate-400">
          {word.partsOfSpeech.join(', ')}
        </p>
      ) : null}
      {word.alternateSurfaces.length > 0 || word.alternateReadings.length > 0 ? (
        <div className="text-sm text-left">
          <p className="font-medium text-slate-500">Alternates</p>
          {word.alternateSurfaces.length > 0 ? (
            <p lang="ja">{word.alternateSurfaces.join('、')}</p>
          ) : null}
          {word.alternateReadings.length > 0 ? (
            <p lang="ja">{word.alternateReadings.join('、')}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function EntryDetails({ entry }: { entry: EntryResponse }) {
  const known = useKnownEntries();
  const isKnown = known.isKnown(entry.entryId);
  const surface = entry.kind === 'kanji' ? entry.kanji.literal : entry.word.surface;
  return (
    <article className="flex w-full flex-col items-center gap-3 text-center">
      {entry.kind === 'kanji' ? (
        <KanjiDetails kanji={entry.kanji} isKnown={isKnown} />
      ) : (
        <WordDetails word={entry.word} isKnown={isKnown} />
      )}
      {known.status !== 'inactive' ? (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <KnownCheckbox entryId={entry.entryId} label={surface} />
          Known
        </label>
      ) : null}
      <SentenceList sentences={entry.sentences} />
    </article>
  );
}
