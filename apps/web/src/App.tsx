import { Navigate, Route, Routes, useParams } from 'react-router';
import { kanjiEntryId } from '@japanesesite/shared';
import { AccountBar } from './components/AccountBar.js';
import { SearchBox } from './components/SearchBox.js';
import { KnownEntriesProvider } from './hooks/useKnownEntries.js';
import { TrailProvider } from './hooks/useTrail.js';
import { EntryPage } from './pages/EntryPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

const DEFAULT_ENTRY_ID = kanjiEntryId('日');

function EntryRoute() {
  const { entryId } = useParams<{ entryId: string }>();
  const id = entryId ?? DEFAULT_ENTRY_ID;
  return (
    <TrailProvider entryId={id}>
      <EntryPage entryId={id} />
    </TrailProvider>
  );
}

export function App() {
  return (
    <KnownEntriesProvider>
      <div className="flex min-h-screen flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
          <span className="text-sm font-semibold text-slate-700">Japanese Entries</span>
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox />
            <AccountBar />
          </div>
        </header>
        <main className="flex flex-1 justify-center p-4">
          <Routes>
            <Route path="/" element={<Navigate to={`/e/${DEFAULT_ENTRY_ID}`} replace />} />
            <Route path="/e/:entryId" element={<EntryRoute />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>
    </KnownEntriesProvider>
  );
}
