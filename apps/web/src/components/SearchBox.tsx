import { useId, useState } from 'react';
import { useSearch } from '../hooks/useSearch.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { EntryLink } from './EntryLink.js';

export function SearchBox() {
  const [text, setText] = useState('');
  const debounced = useDebouncedValue(text, 300);
  const trimmed = debounced.trim();
  const { data, isLoading, isError } = useSearch(trimmed, 10);
  const inputId = useId();
  const listboxId = useId();

  const showResults = trimmed.length > 0;

  return (
    <div className="relative">
      <label htmlFor={inputId} className="sr-only">
        Search entries
      </label>
      <input
        id={inputId}
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Search entries…"
        className="w-64 rounded border border-slate-300 px-2 py-1 text-sm"
        aria-expanded={showResults}
        aria-controls={listboxId}
      />
      {showResults ? (
        <div
          id={listboxId}
          className="absolute z-10 mt-1 w-64 rounded border border-slate-200 bg-white shadow-lg"
        >
          {isLoading ? <p className="p-2 text-sm text-slate-500">Searching…</p> : null}
          {isError ? (
            <p role="alert" className="p-2 text-sm text-red-600">
              Search failed. Try again.
            </p>
          ) : null}
          {data && data.results.length === 0 ? (
            <p className="p-2 text-sm text-slate-500">No matches for "{data.query}".</p>
          ) : null}
          {data && data.results.length > 0 ? (
            <ul>
              {data.results.map((entry) => (
                <li key={entry.entryId}>
                  <EntryLink entry={entry} onClick={() => setText('')} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
