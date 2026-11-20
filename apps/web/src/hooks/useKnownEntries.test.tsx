import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { EntrySummary } from '@japanesesite/shared';
import type * as ApiClientModule from '../api/client.js';
import { ApiClientError } from '../api/client.js';
import { EntryLink } from '../components/EntryLink.js';
import { KnownCheckbox } from '../components/KnownCheckbox.js';
import {
  collectionsFromTable,
  KnownEntriesProvider,
  tableFromCollections,
  toggleInTable,
  useKnownEntries,
} from './useKnownEntries.js';

function SaveButton() {
  const known = useKnownEntries();
  return (
    <button type="button" onClick={() => void known.save()}>
      Save
    </button>
  );
}

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    getSession: vi.fn(),
    getCollections: vi.fn(),
    saveCollections: vi.fn(),
  };
});

import { getCollections, getSession, saveCollections } from '../api/client.js';

const mockedGetSession = vi.mocked(getSession);
const mockedGetCollections = vi.mocked(getCollections);
const mockedSaveCollections = vi.mocked(saveCollections);

const sun: EntrySummary = {
  entryId: 'k:日',
  kind: 'kanji',
  surface: '日',
  reading: 'ニチ',
  meanings: ['day'],
  jlptLevel: 'N5',
};
const book: EntrySummary = {
  entryId: 'w:1',
  kind: 'word',
  surface: '本',
  reading: 'ほん',
  meanings: ['book'],
  jlptLevel: 'N5',
};

function renderWithProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <KnownEntriesProvider>
          <SaveButton />
          {[sun, book].map((entry) => (
            <div key={entry.entryId}>
              <KnownCheckbox entryId={entry.entryId} label={entry.surface} />
              <EntryLink entry={entry} />
            </div>
          ))}
        </KnownEntriesProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('known table helpers', () => {
  it('toggles kanji and words into their own collections', () => {
    let table = tableFromCollections({ kanji: [], vocab: [] });
    table = toggleInTable(table, 'k:日');
    table = toggleInTable(table, 'w:1');
    expect(collectionsFromTable(table)).toEqual({ kanji: ['k:日'], vocab: ['w:1'] });
    table = toggleInTable(table, 'k:日');
    expect(collectionsFromTable(table)).toEqual({ kanji: [], vocab: ['w:1'] });
  });

  it('ignores an invalid entry ID', () => {
    const table = tableFromCollections({ kanji: [], vocab: [] });
    expect(toggleInTable(table, 'bogus')).toBe(table);
  });
});

describe('search results', () => {
  it('marks a known entry with a check mark, not by colour alone', async () => {
    mockedGetSession.mockResolvedValue({ user: { username: 'aki' } });
    mockedGetCollections.mockResolvedValue({
      collections: { kanji: ['k:日'], vocab: [] },
      updatedAt: null,
      version: 1,
    });
    renderWithProvider();
    await waitFor(() => expect(document.querySelector('[data-known]')).not.toBeNull());
    const link = screen.getByText('日').closest('a');
    expect(link).toHaveTextContent('known');
    expect(screen.getByText('本').closest('a')).not.toHaveTextContent('known');
  });
});

describe('KnownEntriesProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows no checkboxes and nothing blue when logged out', async () => {
    mockedGetSession.mockResolvedValue({ user: null });
    renderWithProvider();
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalled());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(document.querySelector('[data-known]')).toBeNull();
    expect(mockedGetCollections).not.toHaveBeenCalled();
  });

  it('loads the saved collections on login and shows known entries checked and blue', async () => {
    mockedGetSession.mockResolvedValue({ user: { username: 'aki' } });
    mockedGetCollections.mockResolvedValue({
      collections: { kanji: ['k:日'], vocab: [] },
      updatedAt: '2026-11-19T00:00:00.000Z',
      version: 1,
    });
    renderWithProvider();

    const sunBox = await screen.findByRole('checkbox', { name: 'Known: 日' });
    await waitFor(() => expect(sunBox).toBeEnabled());
    expect(sunBox).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Known: 本' })).not.toBeChecked();

    const known = document.querySelectorAll('[data-known]');
    expect([...known].map((el) => el.textContent)).toEqual(['日']);
    expect(known[0]).toHaveClass('text-blue-700');
  });

  it('saves the whole table only when Save is pressed, never on a toggle', async () => {
    mockedGetSession.mockResolvedValue({ user: { username: 'aki' } });
    mockedGetCollections.mockResolvedValue({
      collections: { kanji: ['k:日'], vocab: [] },
      updatedAt: null,
      version: 1,
    });
    mockedSaveCollections.mockImplementation(({ collections, version }) =>
      Promise.resolve({ collections, updatedAt: '2026-11-19T00:00:00.000Z', version: version + 1 }),
    );
    const user = userEvent.setup();
    renderWithProvider();

    const bookBox = await screen.findByRole('checkbox', { name: 'Known: 本' });
    await waitFor(() => expect(bookBox).toBeEnabled());
    await user.click(bookBox);
    expect(bookBox).toBeChecked();
    await act(() => new Promise((r) => setTimeout(r, 1500)));
    expect(mockedSaveCollections).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(mockedSaveCollections).toHaveBeenCalledWith({
      username: 'aki',
      version: 1,
      collections: { kanji: ['k:日'], vocab: ['w:1'] },
    });
  });

  it('on a version conflict, reloads the saved blob and replays this page\'s edits on top', async () => {
    mockedGetSession.mockResolvedValue({ user: { username: 'aki' } });
    mockedGetCollections
      .mockResolvedValueOnce({ collections: { kanji: [], vocab: [] }, updatedAt: null, version: 1 })
      // Another tab saved 日 in the meantime.
      .mockResolvedValueOnce({ collections: { kanji: ['k:日'], vocab: [] }, updatedAt: null, version: 2 });
    mockedSaveCollections
      .mockRejectedValueOnce(new ApiClientError(409, 'COLLECTIONS_CONFLICT', 'conflict'))
      .mockImplementation(({ collections, version }) =>
        Promise.resolve({ collections, updatedAt: null, version: version + 1 }),
      );
    const user = userEvent.setup();
    renderWithProvider();

    const bookBox = await screen.findByRole('checkbox', { name: 'Known: 本' });
    await waitFor(() => expect(bookBox).toBeEnabled());
    await user.click(bookBox);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockedSaveCollections).toHaveBeenLastCalledWith({
      username: 'aki',
      version: 2,
      collections: { kanji: ['k:日'], vocab: ['w:1'] },
    });
    expect(screen.getByRole('checkbox', { name: 'Known: 日' })).toBeChecked();
    expect(bookBox).toBeChecked();
  });

  it('warns before unload while a save has failed', async () => {
    mockedGetSession.mockResolvedValue({ user: { username: 'aki' } });
    mockedGetCollections.mockResolvedValue({
      collections: { kanji: [], vocab: [] },
      updatedAt: null,
      version: 0,
    });
    mockedSaveCollections.mockRejectedValue(new ApiClientError(500, 'INTERNAL_ERROR', 'boom'));
    const user = userEvent.setup();
    renderWithProvider();

    const box = await screen.findByRole('checkbox', { name: 'Known: 日' });
    await waitFor(() => expect(box).toBeEnabled());
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(mockedSaveCollections).toHaveBeenCalled();

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('treats a session change reported by a save as logged out or switched, never saving across users', async () => {
    mockedGetSession
      .mockResolvedValueOnce({ user: { username: 'aki' } })
      .mockResolvedValue({ user: null });
    mockedGetCollections.mockResolvedValue({
      collections: { kanji: [], vocab: [] },
      updatedAt: null,
      version: 0,
    });
    mockedSaveCollections.mockRejectedValue(
      new ApiClientError(409, 'SESSION_CHANGED', 'different user'),
    );
    const user = userEvent.setup();
    renderWithProvider();

    const box = await screen.findByRole('checkbox', { name: 'Known: 日' });
    await waitFor(() => expect(box).toBeEnabled());
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('checkbox')).not.toBeInTheDocument());
    expect(mockedSaveCollections).toHaveBeenCalledTimes(1);
  });

  it('keeps checkboxes disabled when the saved collections fail to load', async () => {
    mockedGetSession.mockResolvedValue({ user: { username: 'aki' } });
    mockedGetCollections.mockRejectedValue(new Error('boom'));
    renderWithProvider();

    const box = await screen.findByRole('checkbox', { name: 'Known: 日' });
    await waitFor(() => expect(mockedGetCollections).toHaveBeenCalled());
    expect(box).toBeDisabled();
  });
});
