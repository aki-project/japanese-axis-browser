import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { EntryResponse, LinksResponse } from '@japanesesite/shared';
import type * as ApiClientModule from '../api/client.js';
import type * as ReactRouterModule from 'react-router';
import { TrailProvider } from '../hooks/useTrail.js';
import { EntryPage } from './EntryPage.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    getEntry: vi.fn(),
    getLinks: vi.fn(),
  };
});

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));

// Only useNavigate is swapped for a spy; everything else (Link, Routes,
// MemoryRouter, ...) keeps its real implementation, so <Link> clicks still
// navigate for real while EntryPage's own `navigate(-1)` call is observable.
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterModule>();
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

import { getEntry, getLinks } from '../api/client.js';

const mockedGetEntry = vi.mocked(getEntry);
const mockedGetLinks = vi.mocked(getLinks);

const kanjiEntry: EntryResponse = {
  kind: 'kanji',
  entryId: 'k:日',
  kanji: {
    literal: '日',
    onReadings: ['ニチ'],
    kunReadings: ['ひ'],
    meanings: ['day', 'sun'],
    strokeCount: 4,
    radical: '日',
    components: [],
    etymology: null,
    jlptLevel: 'N5',
    frequency: 1,
  },
  sentences: [],
  linkCounts: { semantic: 1, phonetic: 0, structural: 1 },
};

const linksResponse: LinksResponse = {
  entryId: 'k:日',
  axes: [
    {
      axis: 'semantic',
      total: 1,
      relations: [
        {
          relation: 'synonym',
          entries: [
            {
              relation: 'synonym',
              weight: 1,
              entry: {
                entryId: 'w:1',
                kind: 'word',
                surface: '太陽',
                reading: 'たいよう',
                meanings: ['sun'],
                jlptLevel: 'N3',
              },
            },
          ],
        },
      ],
      nextCursor: null,
    },
    { axis: 'phonetic', total: 0, relations: [], nextCursor: null },
    {
      axis: 'structural',
      total: 1,
      relations: [
        {
          relation: 'shared_radical',
          entries: [
            {
              relation: 'shared_radical',
              weight: null,
              entry: {
                entryId: 'k:明',
                kind: 'kanji',
                surface: '明',
                reading: '',
                meanings: ['bright'],
                jlptLevel: 'N4',
              },
            },
          ],
        },
      ],
      nextCursor: null,
    },
  ],
};

function renderEntryPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/e/k:日']}>
        <TrailProvider entryId="k:日">
          <EntryPage entryId="k:日" />
        </TrailProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EntryPage', () => {
  it('renders a mocked kanji entry and its links grouped by axis', async () => {
    mockedGetEntry.mockResolvedValue(kanjiEntry);
    mockedGetLinks.mockResolvedValue(linksResponse);

    renderEntryPage();

    expect(await screen.findByText('day')).toBeInTheDocument();
    expect(screen.getAllByText('日').length).toBeGreaterThan(0);

    // Axis panels, each with heading + count from linkCounts.
    expect(screen.getByRole('heading', { name: /Semantic/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Phonetic/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Structural/ })).toBeInTheDocument();

    // Links resolve and group under their relation.
    await waitFor(() => {
      expect(screen.getByText('太陽')).toBeInTheDocument();
    });
    expect(screen.getByText('明')).toBeInTheDocument();
    expect(screen.getByText('synonym')).toBeInTheDocument();

    // Empty axis gets its own message.
    expect(screen.getByText(/No phonetic links for this entry/)).toBeInTheDocument();
  });

  it('does not navigate on Backspace when the trail only has one entry', async () => {
    mockedGetEntry.mockResolvedValue(kanjiEntry);
    mockedGetLinks.mockResolvedValue(linksResponse);
    navigateSpy.mockClear();

    renderEntryPage();
    await screen.findByText('day');

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('navigates back on Backspace once the trail has more than one entry', async () => {
    mockedGetEntry.mockResolvedValue(kanjiEntry);
    mockedGetLinks.mockResolvedValue(linksResponse);
    navigateSpy.mockClear();

    const user = userEvent.setup();
    renderEntryPage();
    await screen.findByText('day');

    // Follow a real link (Link's own click handling is untouched by the
    // useNavigate mock) so the trail grows to two entries.
    await user.click(await screen.findByText('太陽'));

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(navigateSpy).toHaveBeenCalledWith(-1);
  });
});
