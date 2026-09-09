import type { Sentence } from '@japanesesite/shared';
import { Furigana } from './Furigana.js';

export function SentenceList({ sentences }: { sentences: readonly Sentence[] }) {
  if (sentences.length === 0) return null;
  return (
    <section aria-labelledby="sentences-heading" className="mt-4 w-full max-w-xl text-left">
      <h2 id="sentences-heading" className="text-sm font-semibold text-slate-700">
        Example sentences
      </h2>
      <ul className="mt-2 flex flex-col gap-3">
        {sentences.map((sentence) => (
          <li key={sentence.tatoebaId} className="border-t border-slate-100 pt-2">
            {sentence.furigana.length > 0 ? (
              <Furigana segments={sentence.furigana} className="text-lg" />
            ) : (
              <span lang="ja" className="text-lg">
                {sentence.japanese}
              </span>
            )}
            <p className="text-sm text-slate-600">{sentence.english}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
